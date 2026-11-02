/**
 * Record the set: everything the decks play (Auto DJ or by hand) as one MP3,
 * with a tracklist timed to the second, ready for YouTube or SoundCloud.
 *
 *  - A small recorder in the audio engine taps the master output and sends
 *    the sound straight to a background MP3 encoder: nothing waits for the
 *    screen, so long sets don't skip.
 *  - The tracklist marks each track at the moment it takes over: the bass
 *    swap of a blend, the drop of an echo-out bridge, or the moment a deck
 *    starts on its own.
 * Nothing leaves the device.
 */
import { audioContext, decks, masterOutput } from "./engine.js";
import { mix, isActive } from "./transition.js";
import { autoDj, isBridgeId, nameOfId } from "./autodj.js";
import { files } from "./files.js";
import { tracklistText } from "../lib/bridge.js";

export const setRec = {
  state: "idle", // idle | recording | finishing | done | error
  seconds: 0,
  bytes: 0,
  entries: [], // { at: seconds into the recording, name, key }
  output: null, // { url, name, size, seconds }
  tracklist: "",
  message: "",
  autoStop: true, // stop a few seconds after Auto DJ finishes the set
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

const TAP = `
class DriftmixTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null; this.on = false; this.fill = 0; this.start = 0;
    this.L = new Float32Array(8192); this.R = new Float32Array(8192);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "port") this.out = m.port;
      else if (m.type === "start") { this.on = true; this.fill = 0; }
      else if (m.type === "stop") { this.flush(); this.on = false; if (this.out) this.out.postMessage({ type: "end" }); }
    };
  }
  flush() {
    if (!this.fill || !this.out) return;
    this.out.postMessage({ type: "chunk", frame: this.start, left: this.L.slice(0, this.fill), right: this.R.slice(0, this.fill) });
    this.fill = 0;
  }
  process(inputs) {
    if (!this.on || !this.out) return true;
    const input = inputs[0];
    const l = input && input[0];
    const r = input && (input[1] || input[0]);
    const n = l ? l.length : 128;
    if (this.fill && currentFrame !== this.start + this.fill) this.flush();
    if (this.fill + n > this.L.length) this.flush();
    if (!this.fill) this.start = currentFrame;
    if (l) { this.L.set(l, this.fill); this.R.set(r, this.fill); }
    else { this.L.fill(0, this.fill, this.fill + n); this.R.fill(0, this.fill, this.fill + n); }
    this.fill += n;
    return true;
  }
}
registerProcessor("driftmix-tap", DriftmixTap);
`;

let tap = null;
let worker = null;
let startTime = 0; // audio-clock time of the first recorded sample
let done = null;

async function ensureTap(ctx) {
  if (tap) return tap;
  if (!ctx.driftmixTap) {
    const url = URL.createObjectURL(new Blob([TAP], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    ctx.driftmixTap = true;
  }
  tap = new AudioWorkletNode(ctx, "driftmix-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
  const silent = ctx.createGain();
  silent.gain.value = 0;
  masterOutput().connect(tap); // after the limiter: the set as the speakers played it
  tap.connect(silent).connect(ctx.destination);
  worker = new Worker(new URL("./setrec.worker.js", import.meta.url), { type: "module" });
  const line = new MessageChannel();
  tap.port.postMessage({ type: "port", port: line.port1 }, [line.port1]);
  worker.postMessage({ type: "port", port: line.port2 }, [line.port2]);
  worker.onmessage = (event) => {
    const m = event.data;
    if (m.type === "started") startTime = m.frame / ctx.sampleRate;
    else if (m.type === "progress") {
      setRec.seconds = m.seconds;
      setRec.bytes = m.bytes;
      setRec.emit();
    } else if (m.type === "done") done?.(m);
    else if (m.type === "error") fail(m.message);
  };
  return tap;
}

function fail(message) {
  setRec.state = "error";
  setRec.message = `Couldn't record: ${message}`;
  setRec.emit();
}

/** The name to put in the tracklist for whatever is on a deck. */
function nameOn(deck) {
  const id = autoDj.onDeck[deck.id];
  if (isBridgeId(id)) return ""; // a bridge clip is a DJ tool, not a track: left out of the tracklist
  return nameOfId(id) || deck.name || "Untitled";
}

function mark(atTime, name, key) {
  if (setRec.state !== "recording" || !name) return;
  const at = Math.max(0, atTime - startTime);
  setRec.entries = setRec.entries.filter((e) => e.key !== key);
  setRec.entries.push({ at, name, key });
  setRec.entries.sort((a, b) => a.at - b.at);
  setRec.emit();
}

/** Start recording what the decks play. */
export async function startSetRecording() {
  if (setRec.state === "recording" || setRec.state === "finishing") return;
  const ctx = audioContext();
  if (!ctx.audioWorklet) return fail("this browser can't record.");
  if (![44100, 48000, 32000].includes(ctx.sampleRate)) return fail(`the sound card runs at ${ctx.sampleRate / 1000} kHz; MP3 needs 44.1 or 48 kHz.`);
  try {
    await ensureTap(ctx);
  } catch (error) {
    return fail(String(error?.message || error));
  }
  discardOutput();
  setRec.entries = [];
  setRec.seconds = 0;
  setRec.bytes = 0;
  setRec.tracklist = "";
  setRec.message = "";
  startTime = ctx.currentTime;
  worker.postMessage({ type: "start", sampleRate: ctx.sampleRate, kbps: 320 });
  tap.port.postMessage({ type: "start" });
  setRec.state = "recording";
  // Whatever is already playing starts the tracklist.
  const playing = Object.values(decks).filter((d) => d.playing);
  const main = playing.sort((x, y) => (y.fader || 0) - (x.fader || 0))[0];
  if (main) mark(ctx.currentTime, nameOn(main), `start-${main.id}`);
  setRec.emit();
}

/** Stop and make the MP3 and the tracklist. */
export function stopSetRecording() {
  if (setRec.state !== "recording") return Promise.resolve();
  setRec.state = "finishing";
  setRec.emit();
  const when = new Date();
  const stampName = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}.${String(when.getMinutes()).padStart(2, "0")}`;
  return new Promise((resolve) => {
    done = (m) => {
      done = null;
      const entries = setRec.entries.filter((e) => e.at < m.seconds - 1);
      const list = tracklistText(dedupe(entries));
      const blob = new Blob([m.bytes], { type: "audio/mpeg" });
      setRec.output = { url: URL.createObjectURL(blob), name: `DriftMix set ${stampName}.mp3`, size: blob.size, seconds: m.seconds };
      setRec.tracklist = list;
      setRec.state = "done";
      setRec.emit();
      resolve();
    };
    const tracklist = tracklistText(dedupe(setRec.entries));
    worker.postMessage({
      type: "tags",
      tags: {
        title: `DriftMix set ${stampName}`,
        artist: files.common.artist || undefined,
        year: String(when.getFullYear()),
        comment: tracklist || undefined,
        copyright: files.common.copyright || undefined,
      },
    });
    tap.port.postMessage({ type: "stop" });
  });
}

/** Two marks for the same track in a row (e.g. a restart) → keep the first. */
function dedupe(entries) {
  const out = [];
  for (const e of entries) if (!out.length || out[out.length - 1].name !== e.name) out.push(e);
  return out;
}

export function discardOutput() {
  if (setRec.output?.url) URL.revokeObjectURL(setRec.output.url);
  setRec.output = null;
  setRec.tracklist = "";
  if (setRec.state === "done" || setRec.state === "error") setRec.state = "idle";
  setRec.emit();
}

export function setAutoStop(on) {
  setRec.autoStop = Boolean(on);
  setRec.emit();
}

// ---- marking the tracklist ----------------------------------------------------

// Blends and bridges: the new track takes over at the bass swap / the drop.
let lastMix = null;
mix.subscribe(() => {
  const s = mix.state;
  if (setRec.state !== "recording" || s === lastMix) return;
  lastMix = s;
  if ((s.status === "waiting" || s.status === "blending") && s.when && s.to) {
    const key = `mix-${s.to}-${s.when.toFixed(3)}`;
    mark(s.when + (s.swapAt ?? 0), nameOn(decks[s.to]), key);
    pending = key;
  } else if (s.status === "idle" && pending) {
    // Cancelled before it finished: take its mark out.
    setRec.entries = setRec.entries.filter((e) => e.key !== pending);
    pending = null;
    setRec.emit();
  } else if (s.status === "done") pending = null;
});
let pending = null;

// A deck starting on its own (not part of a blend): it takes over then.
const wasPlaying = { a: false, b: false };
for (const deck of Object.values(decks)) {
  deck.subscribe(() => {
    const started = deck.playing && !wasPlaying[deck.id];
    wasPlaying[deck.id] = deck.playing;
    if (!started || isActive() || setRec.state !== "recording") return;
    const other = deck.id === "a" ? decks.b : decks.a;
    if (other.playing) return;
    mark(deck.playStart, nameOn(deck), `play-${deck.id}-${deck.playStart.toFixed(3)}`);
  });
}

// Auto DJ finished the set: stop recording once the last notes have rung out.
let wasOn = false;
autoDj.subscribe(() => {
  const ended = wasOn && !autoDj.on && autoDj.message === "Set finished.";
  wasOn = autoDj.on;
  if (ended && setRec.autoStop && setRec.state === "recording") setTimeout(() => void stopSetRecording(), 4000);
});
