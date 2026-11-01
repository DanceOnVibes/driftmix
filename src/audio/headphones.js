/**
 * Headphones: hear a deck before the crowd does.
 *
 * What goes into the headphones: the decks with their headphone button on,
 * blended with the master by CUE MIX (all cue … all master), at their own
 * volume. Where they come out depends on the setup:
 *
 *  - split:  one normal headphone. Left ear = cue, right ear = master
 *            (both in mono), the classic laptop-DJ trick.
 *  - ch34:   a DJ controller or audio interface with 4 outputs: speakers on
 *            outputs 1–2, headphones on 3–4.
 *  - device: a second sound output (USB headphones, an interface), where
 *            the browser lets a page choose one (Chrome, Edge).
 *  - off:    nothing goes to the headphones.
 */
import { audioContext, cueBus, masterOutput, decks } from "./engine.js";

const SAVED = "driftmix.headphones.v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(SAVED) || "{}") || {};
  } catch {
    return {};
  }
}
const start = load();

export const headphones = {
  mode: "off", // off | split | ch34 | device (always starts off: no surprise routing on load)
  deviceId: start.deviceId || "",
  cueMix: typeof start.cueMix === "number" ? start.cueMix : 0, // 0 = all cue, 1 = all master
  volume: typeof start.volume === "number" ? start.volume : 0.8,
  devices: [], // { id, label }
  canChooseDevice: typeof window !== "undefined" && typeof window.AudioContext === "function" && "setSinkId" in AudioContext.prototype,
  fourOutputs: false,
  message: "",
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

function save() {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ deviceId: headphones.deviceId, cueMix: headphones.cueMix, volume: headphones.volume }));
  } catch {
    /* not kept: fine */
  }
}

let mixNodes = null; // the headphone mix (cue + master), always built once used
let route = []; // nodes made for the current output, torn down on a change
let second = null; // the second AudioContext, for "device"

function mix() {
  if (!mixNodes) {
    const ctx = audioContext();
    const cueGain = ctx.createGain();
    const masterGain = ctx.createGain();
    const out = ctx.createGain();
    cueBus(ctx).connect(cueGain).connect(out);
    masterOutput().connect(masterGain).connect(out);
    mixNodes = { cueGain, masterGain, out };
    applyLevels(true);
  }
  return mixNodes;
}

function applyLevels(now = false) {
  if (!mixNodes) return;
  const t = audioContext().currentTime;
  const set = (p, v) => (now ? (p.value = v) : p.setTargetAtTime(v, t, 0.015));
  // An equal-power blend, so the middle isn't quieter than the ends.
  set(mixNodes.cueGain.gain, Math.cos((headphones.cueMix * Math.PI) / 2));
  set(mixNodes.masterGain.gain, Math.sin((headphones.cueMix * Math.PI) / 2));
  set(mixNodes.out.gain, headphones.volume);
}

function teardown() {
  const ctx = audioContext();
  for (const n of route) {
    try {
      n.disconnect();
    } catch {
      /* already */
    }
  }
  route = [];
  if (mixNodes) {
    try {
      mixNodes.out.disconnect();
    } catch {
      /* already */
    }
  }
  if (second) {
    void second.close().catch(() => {});
    second = null;
  }
  // The speakers back to normal: stereo master straight out.
  const dest = ctx.destination;
  try {
    masterOutput().disconnect(dest);
  } catch {
    /* wasn't connected */
  }
  dest.channelCount = 2;
  dest.channelInterpretation = "speakers";
  masterOutput().connect(dest);
}

/** A mono copy of a node (both channels averaged). */
function mono(ctx, from) {
  const g = ctx.createGain();
  g.channelCount = 1;
  g.channelCountMode = "explicit";
  g.channelInterpretation = "speakers";
  from.connect(g);
  route.push(g);
  return g;
}

/** Choose where the headphones come out. */
export async function setHeadphoneMode(mode, deviceId = headphones.deviceId) {
  const ctx = audioContext();
  teardown();
  headphones.message = "";
  headphones.mode = mode;
  if (mode === "off") {
    headphones.emit();
    return;
  }
  const { out } = mix();
  if (mode === "split") {
    masterOutput().disconnect(ctx.destination);
    const merger = ctx.createChannelMerger(2);
    route.push(merger);
    mono(ctx, out).connect(merger, 0, 0); // left ear: cue
    mono(ctx, masterOutput()).connect(merger, 0, 1); // right ear: master
    merger.connect(ctx.destination);
  } else if (mode === "ch34") {
    if (ctx.destination.maxChannelCount < 4) {
      headphones.mode = "off";
      headphones.message = "This sound output only has 2 channels. Plug in a controller or interface with 4 outputs, or use Split.";
      teardown();
      headphones.emit();
      return;
    }
    masterOutput().disconnect(ctx.destination);
    const dest = ctx.destination;
    dest.channelCount = 4;
    dest.channelInterpretation = "discrete";
    const merger = ctx.createChannelMerger(4);
    const sm = ctx.createChannelSplitter(2);
    const sh = ctx.createChannelSplitter(2);
    route.push(merger, sm, sh);
    masterOutput().connect(sm);
    out.connect(sh);
    sm.connect(merger, 0, 0);
    sm.connect(merger, 1, 1);
    sh.connect(merger, 0, 2);
    sh.connect(merger, 1, 3);
    merger.connect(dest);
  } else if (mode === "device") {
    if (!headphones.canChooseDevice || !deviceId) {
      headphones.mode = "off";
      headphones.message = headphones.canChooseDevice ? "Pick the headphones' output first." : "This browser can't send sound to a second output. Use Chrome or Edge, or Split.";
      headphones.emit();
      return;
    }
    const stream = ctx.createMediaStreamDestination();
    route.push(stream);
    out.connect(stream);
    try {
      second = new AudioContext();
      await second.setSinkId(deviceId);
      second.createMediaStreamSource(stream.stream).connect(second.destination);
      headphones.deviceId = deviceId;
      save();
    } catch {
      headphones.message = "That output couldn't be opened. Is it still plugged in?";
      headphones.mode = "off";
      teardown();
    }
  }
  headphones.emit();
}

export function setCueMix(value) {
  headphones.cueMix = Math.max(0, Math.min(1, Number(value) || 0));
  applyLevels();
  save();
  headphones.emit();
}

export function setHeadphoneVolume(value) {
  headphones.volume = Math.max(0, Math.min(1, Number(value) || 0));
  applyLevels();
  save();
  headphones.emit();
}

/** What's plugged in: the sound outputs (and whether 4 outputs are there). */
export async function findOutputs() {
  const ctx = audioContext();
  headphones.fourOutputs = ctx.destination.maxChannelCount >= 4;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    headphones.devices = all
      .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }));
  } catch {
    headphones.devices = [];
  }
  headphones.emit();
}

/** Is any deck on the headphones? (for the panel) */
export function anyOnHeadphones() {
  return decks.a.headphones || decks.b.headphones;
}

/** The headphone mix itself (for the tests and debug view). */
export function headphoneMix() {
  return mix().out;
}
