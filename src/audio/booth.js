/**
 * The Vocal Booth: record your voice over a beat, clean it up, save it.
 *
 *  - The microphone is opened with the browser's "phone call" processing
 *    OFF (echo cancelling, noise cutting, automatic volume). Those are made
 *    for video calls and make singing sound muddy and pumping.
 *  - A small recorder runs inside the audio engine and stamps every block of
 *    sound with the audio clock, so we know exactly when each sample was
 *    heard. Together with the device's delay (measured with clicks, or
 *    estimated), every take is lined up with the beat.
 *  - Clean-up that needs exact timing (rumble cut, gate, compression) is done
 *    on the recording itself; tone, reverb and echo run live so knobs are
 *    heard straight away. Saving renders exactly the same chain.
 * Nothing leaves the device.
 */
import { audioContext } from "./engine.js";
import { analyzeBuffer } from "./analysis.js";
import { files, encodeInWorker } from "./files.js";
import { clickTrain, findClickDelay, alignTake, joinChunks, blip } from "../lib/booth/latency.js";
import { gate, gateSettings, noiseFloorDb, makeImpulse, highpass, compress } from "../lib/booth/voice.js";
import { PRESETS, chainParams, autoVocalDb } from "../lib/booth/presets.js";
import { integratedLufs } from "../lib/files/loudness.js";
import { safeName } from "../lib/files/naming.js";

const SAVED = "driftmix.booth.v1";
const MAX_TAKES = 8;

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED) || "{}") || {};
  } catch {
    return {};
  }
}
const saved = loadSaved();

export const booth = {
  beat: null, // { name, buffer, bpm, firstBeat, camelot, lufs }
  beatStatus: "none", // none | reading | ready | failed
  from: 0, // where recording starts in the beat (seconds, on a bar line)
  countIn: saved.countIn ?? true,
  mic: "off", // off | asking | on | blocked | failed
  inputs: [], // microphones: { id, label }
  inputId: "",
  monitor: false,
  level: -Infinity, // microphone peak, dB
  clipped: false,
  latency: saved.latency ?? null, // { ms, how: "measured" | "estimate" }
  nudgeMs: saved.nudgeMs ?? 0,
  mode: "idle", // idle | measuring | counting | recording | playing | saving
  clock: 0, // seconds into the beat while recording or playing
  takes: [],
  selected: null,
  preset: saved.preset ?? "natural",
  knobs: { ...PRESETS.natural.knobs, ...(saved.knobs || {}) },
  vocalDb: 0, // on top of the automatic level
  beatDb: 0,
  format: saved.format ?? "mp3",
  even: saved.even ?? true,
  outputs: [], // saved files: { name, url, size }
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

function persist() {
  try {
    const { countIn, latency, nudgeMs, preset, knobs, format, even } = booth;
    localStorage.setItem(SAVED, JSON.stringify({ countIn, latency, nudgeMs, preset, knobs, format, even }));
  } catch {
    /* private window: fine */
  }
}

const say = (message) => {
  booth.message = message;
  booth.emit();
};
const dbGain = (db) => 10 ** (db / 20);

// ---- the beat ----------------------------------------------------------------

/** Load the beat to sing over (a File, e.g. from "Load beat" or Files). */
export async function loadBeat(file, name = file.name.replace(/\.[^.]+$/, "")) {
  if (booth.takes.length) return say("Save or clear your takes first: they belong to this beat.");
  stopPlayback();
  booth.beatStatus = "reading";
  booth.beat = null;
  booth.from = 0;
  say("");
  try {
    const ctx = audioContext();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const r = await analyzeBuffer(buffer);
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    booth.beat = {
      name,
      buffer,
      bpm: r.tempo?.bpm ?? null,
      firstBeat: r.tempo?.firstBeat ?? 0,
      camelot: r.key?.camelot ?? null,
      lufs: integratedLufs(channels, buffer.sampleRate),
    };
    booth.beatStatus = "ready";
  } catch {
    booth.beatStatus = "failed";
    booth.message = "That file couldn't be read as audio.";
  }
  booth.emit();
}

/** Use a track already in Files as the beat. */
export function beatFromFiles(id) {
  const it = files.items.find((x) => x.id === id);
  if (it) void loadBeat(it.file, it.title);
}

/** Length of one bar of the beat, in seconds (4 beats; 2 s if no tempo). */
export function barSeconds() {
  return booth.beat?.bpm ? 240 / booth.beat.bpm : 2;
}

/** Start recording from this point, moved to the nearest bar line. */
export function setFrom(seconds) {
  if (!booth.beat || booth.mode !== "idle") return;
  const bar = barSeconds();
  const first = booth.beat.bpm ? booth.beat.firstBeat % bar : 0;
  const n = Math.max(0, Math.round((seconds - first) / bar));
  booth.from = Math.min(booth.beat.buffer.duration - 1, n === 0 && seconds < first ? 0 : first + n * bar);
  if (booth.from < 0.001) booth.from = 0;
  booth.emit();
}

export function setCountIn(on) {
  booth.countIn = Boolean(on);
  persist();
  booth.emit();
}

// ---- the microphone ------------------------------------------------------------

// The recorder: runs in the audio engine, sends blocks of microphone sound
// stamped with the audio clock (currentFrame), plus the level for the meter.
const WORKLET = `
class DriftmixRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.buf = new Float32Array(4096);
    this.fill = 0;
    this.start = 0;
    this.peak = 0;
    this.blocks = 0;
    this.port.onmessage = (e) => {
      if (e.data === "start") { this.on = true; this.fill = 0; }
      else if (e.data === "stop") { this.flush(); this.on = false; this.port.postMessage({ type: "stopped" }); }
    };
  }
  flush() {
    if (this.fill) this.port.postMessage({ type: "chunk", frame: this.start, data: this.buf.slice(0, this.fill) });
    this.fill = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    const n = input ? input.length : 128;
    if (input) for (let i = 0; i < n; i++) { const a = input[i] < 0 ? -input[i] : input[i]; if (a > this.peak) this.peak = a; }
    if (++this.blocks >= 8) { this.port.postMessage({ type: "level", peak: this.peak }); this.peak = 0; this.blocks = 0; }
    if (this.on) {
      if (this.fill && currentFrame !== this.start + this.fill) this.flush();
      if (this.fill + n > this.buf.length) this.flush();
      if (!this.fill) this.start = currentFrame;
      if (input) this.buf.set(input, this.fill); else this.buf.fill(0, this.fill, this.fill + n);
      this.fill += n;
    }
    return true;
  }
}
registerProcessor("driftmix-recorder", DriftmixRecorder);
`;

let stream = null;
let micSource = null;
let recorder = null;
let monitorGain = null;
let chunks = [];
let stopWaiter = null;
let lastLevelEmit = 0;

async function loadWorklet(ctx) {
  if (ctx.driftmixRecorder) return;
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  ctx.driftmixRecorder = true;
}

function onRecorder(event) {
  const m = event.data;
  if (m.type === "chunk") chunks.push(m);
  else if (m.type === "stopped") {
    const done = stopWaiter;
    stopWaiter = null;
    done?.(joinChunks(chunks));
    chunks = [];
  } else if (m.type === "level") {
    booth.level = 20 * Math.log10(m.peak + 1e-9);
    if (m.peak >= 0.99 && (booth.mode === "recording" || booth.mode === "counting")) booth.clipped = true;
    const now = performance.now();
    if (now - lastLevelEmit > 90) {
      lastLevelEmit = now;
      booth.emit();
    }
  }
}

/** Turn the microphone on (asks permission the first time). */
export async function micOn(deviceId = booth.inputId) {
  if (booth.mic === "on" && deviceId === booth.inputId) return true;
  micOff();
  const ctx = audioContext();
  if (!navigator.mediaDevices?.getUserMedia || !ctx.audioWorklet) {
    booth.mic = "failed";
    say("This browser can't record. Chrome, Edge, Firefox and Safari can.");
    return false;
  }
  booth.mic = "asking";
  say("Allow the microphone when your browser asks.");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    await loadWorklet(ctx);
  } catch (error) {
    booth.mic = error?.name === "NotAllowedError" ? "blocked" : "failed";
    say(
      booth.mic === "blocked"
        ? "The microphone is blocked. Click the lock or settings icon next to the address bar, allow the microphone, then try again."
        : "Couldn't open the microphone. Is one plugged in, and not in use by another app?",
    );
    return false;
  }
  micSource = ctx.createMediaStreamSource(stream);
  recorder = new AudioWorkletNode(ctx, "driftmix-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit" });
  recorder.port.onmessage = onRecorder;
  const silent = ctx.createGain();
  silent.gain.value = 0;
  micSource.connect(recorder).connect(silent).connect(ctx.destination); // keeps the recorder running
  monitorGain = ctx.createGain();
  monitorGain.gain.value = booth.monitor ? 1 : 0;
  micSource.connect(monitorGain).connect(ctx.destination);

  const track = stream.getAudioTracks()[0];
  booth.inputId = track?.getSettings().deviceId || deviceId || "";
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    booth.inputs = all.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    booth.inputs = [];
  }
  if (!booth.latency) booth.latency = { ms: estimateMs(ctx, track), how: "estimate" };
  booth.mic = "on";
  say("");
  return true;
}

/** What the browser says its delay is. Often under the truth: measuring is better. */
function estimateMs(ctx, track) {
  const input = track?.getSettings().latency;
  return Math.round(((ctx.baseLatency || 0.01) + (ctx.outputLatency || 0.01) + (typeof input === "number" ? input : 0.01)) * 1000);
}

export function micOff() {
  stream?.getTracks().forEach((t) => t.stop());
  micSource?.disconnect();
  recorder?.disconnect();
  monitorGain?.disconnect();
  stream = micSource = recorder = monitorGain = null;
  if (booth.mic === "on") booth.mic = "off";
  booth.level = -Infinity;
  booth.emit();
}

/** Hear your own voice in the headphones (adds the device's small delay). */
export function setMonitor(on) {
  booth.monitor = Boolean(on);
  if (monitorGain) monitorGain.gain.value = booth.monitor && booth.mode !== "measuring" ? 1 : 0;
  booth.emit();
}

function recStart() {
  chunks = [];
  recorder.port.postMessage("start");
}

function recStop() {
  return new Promise((resolve) => {
    stopWaiter = resolve;
    recorder.port.postMessage("stop");
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Measure this device's delay: clicks through the speakers, heard by the mic.
 * Headphones off, volume up, room quiet, for about 7 seconds.
 */
export async function measureDelay() {
  if (booth.mode !== "idle" || !(await micOn())) return;
  stopPlayback();
  const ctx = audioContext();
  booth.mode = "measuring";
  if (monitorGain) monitorGain.gain.value = 0;
  say("Listening for the clicks: keep quiet for a few seconds…");
  const { samples, times } = clickTrain(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  recStart();
  const t0 = ctx.currentTime + 0.3;
  src.start(t0);
  await wait((samples.length / ctx.sampleRate + 1.2) * 1000);
  const rec = await recStop();
  const r = findClickDelay(rec.samples, ctx.sampleRate, times.map((t) => t + t0), rec.firstFrame / ctx.sampleRate);
  booth.mode = "idle";
  setMonitor(booth.monitor);
  if (r.sure) {
    booth.latency = { ms: Math.round(r.seconds * 1000), how: "measured" };
    booth.nudgeMs = 0;
    persist();
    invalidateTakes();
    say(`Measured: ${booth.latency.ms} ms. Your takes now line up with the beat.`);
  } else {
    const why =
      r.found >= Math.ceil(times.length * 0.6)
        ? "The clicks didn't line up: another sound got in the way."
        : `Heard only ${r.found} of ${times.length} clicks.`;
    say(`${why} Take the headphones off, turn the volume up, keep the room quiet and try again. Until then DriftMix uses an estimate.`);
  }
}

/** Fine-tune by ear: + if your voice sounds late, − if it sounds early. */
export function setNudge(ms) {
  booth.nudgeMs = Math.max(-150, Math.min(150, Math.round(Number(ms) || 0)));
  persist();
  invalidateTakes();
  booth.emit();
}

const delaySeconds = () => ((booth.latency?.ms ?? 30) + booth.nudgeMs) / 1000;

// ---- recording -----------------------------------------------------------------

let session = null;
let ticker = null;
let takeCount = 0;

function tick(startTime, from) {
  clearInterval(ticker);
  ticker = setInterval(() => {
    const t = audioContext().currentTime - startTime;
    if (booth.mode === "counting" && t >= 0) booth.mode = "recording";
    booth.clock = from + t;
    booth.emit();
  }, 100);
}

function click(ctx, when, hz) {
  const data = blip(ctx.sampleRate, { hz, ms: 30, level: 0.5 });
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buffer.copyToChannel(data, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(when);
}

/** Record a take: count-in, then the beat from `from`, recording your voice. */
export async function record() {
  if (booth.mode !== "idle" || !booth.beat) return;
  if (booth.takes.length >= MAX_TAKES) return say(`${MAX_TAKES} takes is the most: delete one you don't need first.`);
  if (!(await micOn())) return;
  stopPlayback();
  const ctx = audioContext();
  const beatLen = booth.beat.bpm ? 60 / booth.beat.bpm : 0.5;
  const count = booth.countIn ? 4 : 0;
  const beatStartTime = ctx.currentTime + 0.3 + count * beatLen;
  booth.clipped = false;
  recStart();
  for (let k = 0; k < count; k++) click(ctx, beatStartTime - (count - k) * beatLen, k === 0 ? 2000 : 1500);
  const src = ctx.createBufferSource();
  src.buffer = booth.beat.buffer;
  const level = ctx.createGain();
  level.gain.value = dbGain(booth.beatDb);
  src.connect(level).connect(ctx.destination);
  src.start(beatStartTime, booth.from);
  src.onended = () => {
    if (session?.src === src) void stopRecording();
  };
  session = { src, beatStartTime, from: booth.from };
  booth.mode = count ? "counting" : "recording";
  booth.clock = booth.from - count * beatLen;
  say("");
  tick(beatStartTime, booth.from);
}

/** Stop recording and keep the take. */
export async function stopRecording() {
  if (!session) return;
  const s = session;
  session = null;
  clearInterval(ticker);
  try {
    s.src.onended = null;
    s.src.stop();
  } catch {
    /* already stopped */
  }
  const rec = await recStop();
  const ctx = audioContext();
  booth.mode = "idle";
  const take = {
    id: String(++takeCount),
    n: takeCount,
    raw: rec.samples,
    sampleRate: ctx.sampleRate,
    recordStart: rec.firstFrame / ctx.sampleRate,
    beatStartTime: s.beatStartTime,
    from: s.from,
    clipped: booth.clipped,
    floorDb: noiseFloorDb(rec.samples, ctx.sampleRate),
    cache: null,
  };
  let peak = 0;
  for (let i = 0; i < take.raw.length; i++) peak = Math.max(peak, Math.abs(take.raw[i]));
  take.peakDb = 20 * Math.log10(peak + 1e-9);
  take.seconds = Math.max(0, take.raw.length / ctx.sampleRate - (s.beatStartTime - take.recordStart));
  if (take.seconds < 0.5) return say("That take was too short to keep.");
  booth.takes.push(take);
  booth.selected = take.id;
  const tips = [];
  if (take.clipped) tips.push("Too loud in places (it hit the top): move back a little or turn the mic down");
  else if (take.peakDb < -30) tips.push("Very quiet: move closer to the mic, or turn it up");
  say(tips.join(". "));
}

export function selectTake(id) {
  stopPlayback();
  booth.selected = id;
  booth.emit();
}

export function deleteTake(id) {
  stopPlayback();
  booth.takes = booth.takes.filter((t) => t.id !== id);
  if (booth.selected === id) booth.selected = booth.takes.at(-1)?.id ?? null;
  booth.emit();
}

export function clearTakes() {
  stopPlayback();
  booth.takes = [];
  booth.selected = null;
  booth.emit();
}

const selectedTake = () => booth.takes.find((t) => t.id === booth.selected) || null;

function invalidateTakes() {
  for (const t of booth.takes) t.cache = null;
}

/**
 * The take, lined up with the beat and cleaned (rumble cut, gate, smooth).
 * Sample 0 sits on the beat at `take.from`. Cached until a setting changes.
 */
export function takeVoice(take) {
  const key = `${delaySeconds()}|${booth.knobs.clean}|${booth.knobs.squeeze}`;
  if (take.cache?.key === key) return take.cache;
  let v = alignTake(take.raw, take.sampleRate, { recordStart: take.recordStart, beatStartTime: take.beatStartTime, latency: delaySeconds() });
  v = highpass(v, take.sampleRate, 80);
  const g = gateSettings(booth.knobs.clean, take.floorDb);
  if (g) v = gate(v, take.sampleRate, g);
  const comp = chainParams(booth.knobs).comp;
  if (comp) v = compress(v, take.sampleRate, comp);
  const lufs = integratedLufs([v], take.sampleRate);
  take.cache = { key, voice: v, autoDb: autoVocalDb(lufs, booth.beat?.lufs ?? -14) };
  return take.cache;
}

// ---- the live chain (and the same chain for saving) ---------------------------------

let impulseCache = null;
function impulseFor(ctx) {
  if (impulseCache?.rate !== ctx.sampleRate) {
    const [l, r] = makeImpulse(ctx.sampleRate);
    impulseCache = { rate: ctx.sampleRate, l, r };
  }
  const buffer = ctx.createBuffer(2, impulseCache.l.length, ctx.sampleRate);
  buffer.copyToChannel(impulseCache.l, 0);
  buffer.copyToChannel(impulseCache.r, 1);
  return buffer;
}

/**
 * Vocal → mud cut → presence → air → level → out, with reverb and echo sends;
 * beat → level → out. Returns the inputs and a function to update settings.
 */
function buildChain(ctx, destination) {
  const out = ctx.createGain();
  out.connect(destination);
  const vocalIn = ctx.createGain();
  const mud = ctx.createBiquadFilter();
  mud.type = "peaking";
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  const air = ctx.createBiquadFilter();
  air.type = "highshelf";
  const vocalLevel = ctx.createGain();
  vocalIn.connect(mud).connect(presence).connect(air).connect(vocalLevel).connect(out);
  const reverbSend = ctx.createGain();
  const room = ctx.createConvolver();
  room.buffer = impulseFor(ctx);
  vocalLevel.connect(reverbSend).connect(room).connect(out);
  const echoSend = ctx.createGain();
  const echo = ctx.createDelay(2);
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 4500;
  const feedback = ctx.createGain();
  vocalLevel.connect(echoSend).connect(echo).connect(echoTone).connect(out);
  echoTone.connect(feedback).connect(echo);
  const beatIn = ctx.createGain();
  beatIn.connect(out);

  function update(autoDb) {
    const p = chainParams(booth.knobs, booth.beat?.bpm);
    mud.frequency.value = p.mud.hz;
    mud.Q.value = p.mud.q;
    mud.gain.value = p.mud.gainDb;
    presence.frequency.value = p.presence.hz;
    presence.Q.value = p.presence.q;
    presence.gain.value = p.presence.gainDb;
    air.frequency.value = p.air.hz;
    air.gain.value = p.air.gainDb;
    vocalLevel.gain.value = dbGain(autoDb + booth.vocalDb);
    reverbSend.gain.value = p.reverb;
    echoSend.gain.value = p.echo.level;
    echo.delayTime.value = p.echo.time;
    feedback.gain.value = p.echo.feedback;
    beatIn.gain.value = dbGain(booth.beatDb);
  }
  return { vocalIn, beatIn, update, out };
}

let live = null;

/** Play the selected take with the beat, through the effects. */
export function play() {
  const take = selectedTake();
  if (!take || !booth.beat || booth.mode !== "idle") return;
  const ctx = audioContext();
  const { voice, autoDb } = takeVoice(take);
  const chain = buildChain(ctx, ctx.destination);
  chain.update(autoDb);
  const when = ctx.currentTime + 0.08;
  const beat = ctx.createBufferSource();
  beat.buffer = booth.beat.buffer;
  beat.connect(chain.beatIn);
  const vb = ctx.createBuffer(1, Math.max(1, voice.length), take.sampleRate);
  vb.copyToChannel(voice, 0);
  const vocal = ctx.createBufferSource();
  vocal.buffer = vb;
  vocal.connect(chain.vocalIn);
  beat.start(when, take.from);
  vocal.start(when);
  // Stop a couple of seconds after the take ends (or at the end of the beat).
  const end = Math.min(booth.beat.buffer.duration - take.from, voice.length / take.sampleRate + 2);
  beat.stop(when + end);
  beat.onended = () => {
    if (live?.beat === beat) stopPlayback();
  };
  live = { beat, vocal, chain, autoDb };
  booth.mode = "playing";
  tick(when, take.from);
  booth.emit();
}

export function stopPlayback() {
  if (!live) return;
  const l = live;
  live = null;
  clearInterval(ticker);
  for (const src of [l.beat, l.vocal]) {
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* not started */
    }
  }
  l.chain.out.disconnect();
  booth.mode = "idle";
  booth.emit();
}

function refreshLive(rebuildVoice) {
  if (!live) return;
  if (rebuildVoice) {
    // Clean / Smooth change the recording itself: restart from the start of the take.
    stopPlayback();
    play();
    return;
  }
  live.chain.update(live.autoDb);
}

export function setKnob(id, value) {
  booth.knobs = { ...booth.knobs, [id]: Number(value) };
  booth.preset = "custom";
  persist();
  refreshLive(id === "clean" || id === "squeeze");
  booth.emit();
}

export function setPreset(name) {
  if (!PRESETS[name]) return;
  booth.knobs = { ...PRESETS[name].knobs };
  booth.preset = name;
  persist();
  refreshLive(true);
  booth.emit();
}

export function setLevel(which, db) {
  booth[which === "beat" ? "beatDb" : "vocalDb"] = Math.max(-24, Math.min(12, Number(db) || 0));
  refreshLive(false);
  booth.emit();
}

export function setFormat(format) {
  booth.format = format === "wav" ? "wav" : "mp3";
  persist();
  booth.emit();
}

export function setEven(on) {
  booth.even = Boolean(on);
  persist();
  booth.emit();
}

// ---- saving ------------------------------------------------------------------------

/**
 * Save the selected take.
 *  "mix":   the whole beat with your vocal, effects on.
 *  "vocal": just your vocal with effects, from 0:00 of the beat (drop it at
 *           the start of a music app's timeline and it lines up).
 *  "raw":   your vocal exactly as recorded (lined up, nothing else), WAV.
 */
export async function save(kind) {
  const take = selectedTake();
  if (!take || !booth.beat || booth.mode !== "idle") return;
  stopPlayback();
  booth.mode = "saving";
  say("Making the file…");
  try {
    const rate = take.sampleRate;
    const { voice, autoDb } = takeVoice(take);
    const beatLength = Math.round(booth.beat.buffer.duration * rate);
    const offset = Math.round(take.from * rate);
    let channels;
    if (kind === "raw") {
      const raw = alignTake(take.raw, rate, { recordStart: take.recordStart, beatStartTime: take.beatStartTime, latency: delaySeconds() });
      const out = new Float32Array(offset + raw.length);
      out.set(raw, offset);
      channels = [out];
    } else {
      const tail = Math.round(2.5 * rate);
      const length = kind === "mix" ? beatLength : offset + voice.length + tail;
      const off = new OfflineAudioContext(2, length, rate);
      const chain = buildChain(off, off.destination);
      chain.update(autoDb);
      const vb = off.createBuffer(1, Math.max(1, voice.length), rate);
      vb.copyToChannel(voice, 0);
      const vocal = off.createBufferSource();
      vocal.buffer = vb;
      vocal.connect(chain.vocalIn);
      vocal.start(take.from);
      if (kind === "mix") {
        const beat = off.createBufferSource();
        beat.buffer = booth.beat.buffer;
        beat.connect(chain.beatIn);
        beat.start(0);
      }
      const rendered = await off.startRendering();
      channels = [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
    }
    const wav = kind === "raw" || booth.format === "wav";
    const settings = {
      format: wav ? "wav" : "mp3",
      bitrate: 320,
      bitDepth: 24,
      channels: channels.length === 1 ? "mono" : "stereo",
      loudness: kind === "mix" && booth.even ? "-14" : "off",
      trim: false,
    };
    const label = { mix: "vocal mix", vocal: "vocal", raw: `raw take ${take.n}` }[kind];
    const title = `${booth.beat.name} (${label})`;
    const tags = {
      title,
      artist: files.common.artist || undefined,
      year: files.common.year || undefined,
      bpm: booth.beat.bpm ? Math.round(booth.beat.bpm) : undefined,
      comment: "Vocals recorded in DriftMix",
      copyright: files.common.copyright || undefined,
    };
    const result = await encodeInWorker(channels, rate, settings, tags);
    const blob = new Blob([result.bytes], { type: wav ? "audio/wav" : "audio/mpeg" });
    const name = `${safeName(title) || "vocal"}.${wav ? "wav" : "mp3"}`;
    const url = URL.createObjectURL(blob);
    booth.outputs = [{ name, url, size: blob.size, kind }, ...booth.outputs.filter((o) => o.name !== name)].slice(0, 6);
    downloadNow(url, name);
    const l = result.loudness;
    say(
      l
        ? `Saved ${name} · ${l.result.toFixed(1)} LUFS${l.heldBack ? " (a little under −14: DriftMix won't let the peaks clip)" : ""}.`
        : `Saved ${name}.`,
    );
  } catch (error) {
    say(`Couldn't save: ${error?.message || error}`);
  } finally {
    booth.mode = "idle";
    booth.emit();
  }
}

function downloadNow(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
