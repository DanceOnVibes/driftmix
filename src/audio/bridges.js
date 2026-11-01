/**
 * The Bridges list: the DJ's short beat-only clips that Auto DJ plays
 * between tracks (see lib/bridgeClip.js). Each clip is read once (tempo and
 * first downbeat) and trimmed to whole bars; when a bridge is due, the clip
 * is looped to the bridge's length and handed to a deck like any track.
 * Kept on this device with the playlist.
 */
import { audioContext } from "./engine.js";
import { analyzeBuffer, localGrid } from "./analysis.js";
import { trimClip, loopClip, clipBpmFromName, BRIDGE_BARS } from "../lib/bridgeClip.js";
import { encodeWav } from "../lib/files/wav.js";
import { tidyName } from "../lib/files/naming.js";

const AUDIO_NAME = /\.(mp3|wav|flac|aiff?|m4a|aac|ogg|opus)$/i;

export const bridges = {
  /** @type {{ id: string, file: File, name: string, status: "reading"|"ready"|"failed", bpm: number|null, firstBeat: number, bars: number, start: number, end: number, note: string }[]} */
  clips: [],
  mode: "every", // every | clash (only when the keys clash) | off
  used: 0, // bridges played in this set (to take turns)
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

let nextId = 1;
let reading = Promise.resolve();

/** Add clips (files), or put kept ones back (with what was read from them). */
export function addClips(list) {
  for (const entry of [...list]) {
    const file = entry instanceof Blob ? entry : entry.file;
    if (!file || !(file.type.startsWith("audio/") || AUDIO_NAME.test(file.name))) continue;
    if (bridges.clips.some((c) => c.file === file)) continue;
    const clip = { id: `c${nextId++}`, file, name: entry instanceof Blob ? tidyName(file.name) : entry.name ?? tidyName(file.name), status: "reading", bpm: null, firstBeat: 0, bars: 0, start: 0, end: 0, note: "" };
    if (entry.bpm && entry.bars) Object.assign(clip, { bpm: entry.bpm, firstBeat: entry.firstBeat ?? 0, bars: entry.bars, start: entry.start ?? 0, end: entry.end, status: "ready" });
    bridges.clips.push(clip);
    if (clip.status === "reading") reading = reading.then(() => readClip(clip));
  }
  bridges.emit();
}

async function readClip(clip) {
  try {
    const buffer = await audioContext().decodeAudioData(await clip.file.arrayBuffer());
    if (buffer.duration < 4.8) throw new Error("too short: under 4 bars (make it 4 or 8 bars)"); // 4 bars at 200 BPM
    const found = await analyzeBuffer(buffer);
    let bpm = found.tempo?.bpm ?? null;
    let firstBeat = found.tempo?.firstBeat ?? 0;
    const named = clipBpmFromName(clip.file.name);
    if (!bpm && named) {
      bpm = named; // a clip too short or sparse to read: trust the tempo in its name, start at the top
      firstBeat = 0;
    }
    if (bpm && buffer.duration >= 4) {
      // The exact tempo over the whole clip, so its repeats stay on the beat.
      const g = await localGrid(buffer, 0, buffer.duration, bpm).catch(() => null);
      if (g && g.confidence > 0.3 && Math.abs(g.bpm / bpm - 1) < 0.01) {
        bpm = g.bpm;
        const beat = 60 / bpm;
        firstBeat = g.beat - Math.round((g.beat - firstBeat) / beat) * beat;
      }
    }
    const trim = trimClip(buffer.duration, { bpm, firstBeat });
    if (!bpm) throw new Error("no steady beat found (put its tempo in the name, e.g. “drums 128”)");
    if (!trim) throw new Error(`too short: under 4 bars at ${Math.round(bpm)} BPM`);
    Object.assign(clip, { bpm, firstBeat, ...trim, status: "ready", note: "" });
  } catch (error) {
    clip.status = "failed";
    clip.note = String(error?.message || error);
  }
  bridges.emit();
}

export function removeClip(id) {
  bridges.clips = bridges.clips.filter((c) => c.id !== id);
  bridges.emit();
}

export function setClipMode(mode) {
  bridges.mode = mode;
  bridges.emit();
}

export const readyClips = () => bridges.clips.filter((c) => c.status === "ready");

/**
 * The next clip (taking turns), looped to a bridge's length, as a track a
 * deck can load: { file, name, tempo }.
 */
export async function makeBridge() {
  const ready = readyClips();
  if (!ready.length) return null;
  const clip = ready[bridges.used % ready.length];
  bridges.used++;
  const buffer = await audioContext().decodeAudioData(await clip.file.arrayBuffer());
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
  const looped = loopClip(channels, buffer.sampleRate, clip, BRIDGE_BARS);
  const bytes = encodeWav(looped, buffer.sampleRate, 16, { title: clip.name });
  const file = new File([bytes], `${clip.name} (bridge).wav`, { type: "audio/wav" });
  return {
    clip,
    file,
    name: clip.name,
    tempo: { bpm: clip.bpm, firstBeat: 0, sure: true, downbeatSure: true, confidence: 1 },
  };
}

/** For the playlist kept on this device. */
export function restoreClips(list, mode) {
  if (mode) bridges.mode = mode;
  if (list?.length) addClips(list);
  bridges.emit();
}
