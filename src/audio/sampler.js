/**
 * The Sample maker and pads.
 *
 *  - Pick a deck, tap where the sample starts (it snaps to the beat), choose
 *    its length in beats. Preview it once or looping.
 *  - Save it to one of 8 pads. Tap a pad to play it over the mix: it lands
 *    on the next beat of the playing track, at that track's tempo.
 *  - Save a pad as a WAV, exactly that many beats long, named with its BPM
 *    and key: on a USB stick it loops cleanly with Beat Loop on a CDJ/XDJ.
 *  - Use a pad as the snippet in a Build-up.
 *
 * Pads are kept on this device (see keep.js) like the Files list.
 */
import { audioContext, decks, masterNode } from "./engine.js";
import { stretchBuffer } from "./analysis.js";
import { nowAndNext } from "./transition.js";
import { snapTo, sampleRange, cutSample, nextBeatTime, sampleName } from "../lib/sampler.js";
import { encodeWav } from "../lib/files/wav.js";
import { makeZip } from "../lib/files/zip.js";
import { shortKey } from "../lib/files/naming.js";
import { offerUndo } from "./files.js";

export const PAD_COUNT = 8;

export const sampler = {
  deck: "a", // which deck the sample is cut from
  start: null, // track seconds (snapped), or null = not chosen yet
  beats: 4,
  snap: 1, // beats: 1 or 0.5
  cutLow: false, // take out bass and kick (vocals, leads, hats)
  previewing: null, // "once" | "loop" | null
  /** @type {({ id: number, name: string, title: string, beats: number, bpm: number, camelot: string|null, keyName: string|null, cutLow: boolean, sampleRate: number, channels: Float32Array[] } | null)[]} */
  pads: Array(PAD_COUNT).fill(null),
  padsVersion: 0, // goes up whenever a pad is saved, cleared or put back
  buildUpFrom: "incoming", // the Build-up snippet: "incoming" | "outgoing" | "pad:<n>"
  playing: new Set(), // pad indexes sounding now
  message: "",
  undo: null, // the pad just cleared, for 10 seconds
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

let padId = 1;

const source = () => decks[sampler.deck];
const tempoOf = (deck) => deck.analysis.tempo;

/** Choose the deck to cut from. The start moves to the middle of the track. */
export function setDeck(id) {
  stopPreview();
  sampler.deck = id;
  sampler.start = null;
  sampler.emit();
}

/** Tap on the track (0..1 of its length, or track seconds): snaps to the grid. */
export function setStart(seconds) {
  const deck = source();
  const t = tempoOf(deck);
  if (!deck.buffer || !t) return;
  sampler.start = Math.min(snapTo(seconds, t, sampler.snap), Math.max(0, deck.duration - sampleSeconds()));
  sampler.emit();
  if (sampler.previewing) restartPreview();
}

/** Move the start by whole snap steps (← →). */
export function nudge(steps) {
  const t = tempoOf(source());
  if (!t) return;
  setStart(currentStart() + (steps * sampler.snap * 60) / t.bpm);
}

export function setBeats(n) {
  sampler.beats = n;
  sampler.emit();
  if (sampler.previewing) restartPreview();
}

export function setSnap(step) {
  sampler.snap = step;
  sampler.emit();
}

export function setCutLow(on) {
  sampler.cutLow = Boolean(on);
  sampler.emit();
  if (sampler.previewing) restartPreview();
}

/** Seconds the sample lasts at the track's own tempo. */
export function sampleSeconds() {
  const t = tempoOf(source());
  return t ? (sampler.beats * 60) / t.bpm : 0;
}

/** Where the sample starts: the chosen point, or (to begin with) the deck's playhead or cue, snapped. */
export function currentStart() {
  if (sampler.start !== null) return sampler.start;
  const deck = source();
  const t = tempoOf(deck);
  if (!deck.buffer || !t) return 0;
  const from = deck.position > 0 ? deck.position : deck.cue > 0 ? deck.cue : Math.max(0, t.firstBeat) + 16 * 4 * (60 / t.bpm);
  return Math.min(snapTo(from, t, sampler.snap), Math.max(0, deck.duration - sampleSeconds()));
}

/** Can a sample be made from the chosen deck? ("" = yes) */
export function whyNotSample() {
  const deck = source();
  if (!deck.buffer) return `Load a track on deck ${sampler.deck.toUpperCase()} first.`;
  if (deck.analysis.status === "working") return "Reading the tempo…";
  if (!tempoOf(deck)) return "This track has no steady beat to cut on.";
  return "";
}

/** The sample as it is set now. */
function makeSample() {
  const deck = source();
  const t = tempoOf(deck);
  const buffer = deck.buffer;
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
  const { from, frames } = sampleRange({ start: currentStart(), beats: sampler.beats, bpm: t.bpm, sampleRate: buffer.sampleRate, length: buffer.length });
  const cut = cutSample(channels, from, frames, { sampleRate: buffer.sampleRate, cutLowHz: sampler.cutLow ? 250 : 0 });
  const key = deck.analysis.key;
  return {
    title: deck.name || "Sample",
    beats: sampler.beats,
    bpm: t.bpm,
    camelot: key?.camelot ?? null,
    keyName: key?.name ?? null,
    cutLow: sampler.cutLow,
    sampleRate: buffer.sampleRate,
    channels: cut,
  };
}

function toBuffer(s) {
  const ctx = audioContext();
  const b = ctx.createBuffer(s.channels.length, s.channels[0].length, s.sampleRate);
  s.channels.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}

// ---- preview -----------------------------------------------------------------

let preview = null; // { src, gain }

export function stopPreview() {
  if (preview) {
    try {
      preview.src.stop();
    } catch {
      /* done */
    }
    preview.gain.disconnect();
    preview = null;
  }
  if (sampler.previewing) {
    sampler.previewing = null;
    sampler.emit();
  }
}

/** Hear the sample: once, or looping (as it would on Beat Loop). */
export function startPreview(mode = "once") {
  if (whyNotSample()) return;
  stopPreview();
  const ctx = audioContext();
  void ctx.resume?.();
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(makeSample());
  src.loop = mode === "loop";
  const gain = ctx.createGain();
  src.connect(gain).connect(masterNode());
  src.onended = () => {
    if (preview?.src === src) {
      preview = null;
      sampler.previewing = null;
      sampler.emit();
    }
  };
  src.start();
  preview = { src, gain };
  sampler.previewing = mode;
  sampler.emit();
}

function restartPreview() {
  const mode = sampler.previewing;
  if (mode) startPreview(mode);
}

// ---- pads -------------------------------------------------------------------

/** Save the sample to a pad (the first empty one if none is named). */
export function saveToPad(index = sampler.pads.indexOf(null)) {
  if (whyNotSample()) return -1;
  const i = index >= 0 ? index : 0;
  const s = makeSample();
  sampler.pads[i] = { id: padId++, name: padLabel(s), ...s };
  sampler.padsVersion++;
  cache.delete(i);
  sampler.message = `Saved to pad ${i + 1}.`;
  sampler.emit();
  return i;
}

function padLabel(s) {
  const len = s.beats === 0.5 ? "½ beat" : `${s.beats} beat${s.beats === 1 ? "" : "s"}`;
  return `${s.title} · ${len}`;
}

export function clearPad(i) {
  stopPad(i);
  if (sampler.pads[i]) offerUndo(sampler, { index: i, pad: sampler.pads[i] }, `Cleared pad ${i + 1}.`);
  sampler.pads[i] = null;
  sampler.padsVersion++;
  if (sampler.buildUpFrom === `pad:${i}`) sampler.buildUpFrom = "incoming";
  cache.delete(i);
  sampler.emit();
}

/** Bring back the pad that was just cleared (within 10 seconds), if its place is still free. */
export function undoClear() {
  const u = sampler.undo;
  if (!u) return;
  const i = sampler.pads[u.index] ? sampler.pads.indexOf(null) : u.index;
  if (i < 0) return;
  sampler.pads[i] = u.pad;
  sampler.padsVersion++;
  sampler.undo = null;
  sampler.emit();
}

/** Put back pads kept on this device. */
export function restorePads(saved) {
  (saved || []).forEach((p, i) => {
    if (p && i < PAD_COUNT && !sampler.pads[i]) sampler.pads[i] = { ...p, id: padId++ };
  });
  sampler.padsVersion++;
  sampler.emit();
}

const cache = new Map(); // pad index → { bpm, buffer } at the playing tempo
const sounding = new Map(); // pad index → { src, gain }

/** The pad's audio at `bpm` (its own tempo if null): stretched once, then kept. */
async function padAt(i, bpm) {
  const pad = sampler.pads[i];
  const own = !bpm || Math.abs(bpm - pad.bpm) < 0.05;
  const want = own ? pad.bpm : bpm;
  const hit = cache.get(i);
  if (hit && hit.id === pad.id && Math.abs(hit.bpm - want) < 1e-6) return hit.buffer;
  const base = toBuffer(pad);
  const buffer = own ? base : await stretchBuffer(base, want / pad.bpm, audioContext());
  cache.set(i, { id: pad.id, bpm: want, buffer });
  return buffer;
}

/** What's playing that a pad should follow: tempo and grid, or null. */
function playingGrid() {
  const [now] = nowAndNext();
  const t = now.analysis.tempo;
  if (!now.playing || !t) return null;
  return { deck: now, bpm: now.playingBpm, grid: { now: audioContext().currentTime, position: now.position, speed: now.speed, bpm: t.bpm, firstBeat: t.firstBeat } };
}

/**
 * Tap a pad: it plays from the next beat of the playing track (or the next
 * half beat for short samples), at the playing tempo. Tapping a sounding
 * pad again starts it again on the next beat. Looping pads play until
 * tapped off.
 */
export async function firePad(i, { loop = false } = {}) {
  const pad = sampler.pads[i];
  if (!pad) return;
  const ctx = audioContext();
  void ctx.resume?.();
  if (loop && sounding.has(i) && sounding.get(i).loop) return stopPad(i);
  const g = playingGrid();
  let buffer;
  try {
    buffer = await padAt(i, g?.bpm ?? null);
  } catch {
    return;
  }
  const when = g ? nextBeatTime({ ...g.grid, now: ctx.currentTime, position: g.deck.position }, pad.beats < 1 ? 0.5 : 1, 0.03) : ctx.currentTime + 0.01;
  stopPad(i, when);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  const gain = ctx.createGain();
  src.connect(gain).connect(masterNode());
  src.onended = () => {
    if (sounding.get(i)?.src === src) {
      sounding.delete(i);
      sampler.playing.delete(i);
      sampler.emit();
    }
  };
  src.start(when);
  sounding.set(i, { src, gain, loop, when });
  sampler.playing.add(i);
  sampler.lastFire = { pad: i, when, onBeat: Boolean(g), seconds: buffer.duration, bpm: g?.bpm ?? pad.bpm };
  sampler.emit();
}

/** Stop a pad (at `when`, or now), with a short fade so it doesn't click. */
export function stopPad(i, when = null) {
  const s = sounding.get(i);
  if (!s) return;
  const ctx = audioContext();
  const at = Math.max(ctx.currentTime, when ?? ctx.currentTime);
  s.gain.gain.setValueAtTime(1, at);
  s.gain.gain.linearRampToValueAtTime(0, at + 0.008);
  try {
    s.src.stop(at + 0.01);
  } catch {
    /* done */
  }
  sounding.delete(i);
  sampler.playing.delete(i);
  sampler.emit();
}

// ---- saving as files -----------------------------------------------------------

/** A pad as a WAV file (24-bit, its own sample rate), BPM and key in the tags and name. */
export function padFile(i) {
  const pad = sampler.pads[i];
  if (!pad) return null;
  const bytes = encodeWav(pad.channels, pad.sampleRate, 24, {
    title: pad.name.replace(" · ", " - "),
    bpm: Math.round(pad.bpm),
    key: shortKey(pad.keyName),
    comment: [pad.camelot, `${pad.beats} beats at ${Math.round(pad.bpm * 100) / 100} BPM`, "DriftMix sample"].filter(Boolean).join(" · "),
  });
  const name = sampleName({ title: pad.title, beats: pad.beats, bpm: pad.bpm, camelot: pad.camelot });
  return { name, bytes, blob: new Blob([bytes], { type: "audio/wav" }) };
}

/** Every pad in one zip. */
export function allPadsZip() {
  const entries = [];
  const used = new Set();
  sampler.pads.forEach((p, i) => {
    if (!p) return;
    const f = padFile(i);
    let name = `${String(i + 1).padStart(2, "0")} ${f.name}`;
    while (used.has(name)) name = name.replace(/\.wav$/, " (2).wav");
    used.add(name);
    entries.push({ name, data: f.bytes });
  });
  if (!entries.length) return null;
  return { name: "DriftMix samples.zip", blob: new Blob([makeZip(entries)], { type: "application/zip" }) };
}

/** Where the next Build-up's snippet comes from ("incoming", "outgoing" or "pad:<n>"). */
export function setBuildUpFrom(value) {
  sampler.buildUpFrom = value;
  if (value.startsWith("pad:")) sampler.message = `Pad ${Number(value.slice(4)) + 1} is the snippet for the next Build-up.`;
  sampler.emit();
}

/** The Build-up's settings from that choice. */
export function buildUpChoice() {
  const v = sampler.buildUpFrom;
  if (v.startsWith("pad:")) {
    const snippet = padSnippet(Number(v.slice(4)));
    if (snippet) return { from: "pad", snippet };
    return { from: "incoming", snippet: null };
  }
  return { from: v, snippet: null };
}

/** A pad as a Build-up snippet. */
export function padSnippet(i) {
  const p = sampler.pads[i];
  return p ? { channels: p.channels, sampleRate: p.sampleRate, bpm: p.bpm, name: p.name } : null;
}
