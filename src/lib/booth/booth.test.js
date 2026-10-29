// Vocal Booth tests: delay measuring, lining up, gate, reverb, knobs. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { clickTrain, findClickDelay, alignTake, joinChunks } from "./latency.js";
import { gate, gateSettings, noiseFloorDb, makeImpulse, highpass, compress } from "./voice.js";
import { chainParams, PRESETS, KNOBS, autoVocalDb } from "./presets.js";

const sr = 48000;
function noise(n, level, seed = 1) {
  let a = seed;
  return new Float32Array(n).map(() => {
    a = (a * 16807) % 2147483647;
    return ((a / 2147483647) * 2 - 1) * level;
  });
}

/** What a microphone would hear: the clicks, late, quieter, with a room echo and noise. */
function heard({ delay, recordStart = 0.05, level = 0.2, echo = 0.5, noiseLevel = 0.003 }) {
  const { samples, times } = clickTrain(sr);
  const n = samples.length + sr;
  const out = noise(n, noiseLevel);
  const shift = Math.round((delay - recordStart) * sr);
  const bounce = Math.round(0.012 * sr);
  for (let i = 0; i < samples.length; i++) {
    const j = i + shift;
    if (j >= 0 && j < n) out[j] += samples[i] * level;
    if (j + bounce >= 0 && j + bounce < n) out[j + bounce] += samples[i] * level * echo;
  }
  return { recorded: out, times, recordStart };
}

test("delay: finds a 137 ms round trip to within 0.5 ms, through room echo and noise", () => {
  const h = heard({ delay: 0.137 });
  const r = findClickDelay(h.recorded, sr, h.times, h.recordStart);
  assert.equal(r.sure, true);
  assert.ok(Math.abs(r.seconds - 0.137) < 0.0005, `${(r.seconds * 1000).toFixed(2)} ms`);
});

test("delay: a slow phone (380 ms) and a quick laptop (12 ms)", () => {
  for (const delay of [0.38, 0.012]) {
    const h = heard({ delay });
    const r = findClickDelay(h.recorded, sr, h.times, h.recordStart);
    assert.ok(r.sure && Math.abs(r.seconds - delay) < 0.0005, `${delay}: ${r.seconds}`);
  }
});

test("delay: clicks drowned by the room, or a mic that hears nothing, give no answer (no guessing)", () => {
  const loud = heard({ delay: 0.1, level: 0.002, noiseLevel: 0.05 });
  assert.equal(findClickDelay(loud.recorded, sr, loud.times, loud.recordStart).sure, false);
  const { times } = clickTrain(sr);
  assert.equal(findClickDelay(noise(sr * 7, 0.01), sr, times, 0).sure, false);
  assert.equal(findClickDelay(new Float32Array(sr * 7), sr, times, 0).sure, false);
});

test("delay: singing (or music) during the clicks is not mistaken for a 0 ms device", () => {
  // Sung phrases (1.5 s on, 0.5 s off) and no clicks at all, like a voice in the room.
  const { times } = clickTrain(sr);
  const n = sr * 8;
  const voice = noise(n, 0.0015, 5);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t % 2 < 1.5) for (let h = 1; h < 10; h++) voice[i] += (0.25 / h ** 1.3) * Math.sin(2 * Math.PI * 220 * h * t);
  }
  const r = findClickDelay(voice, sr, times, 0);
  assert.equal(r.sure, false, `gave ${r.seconds}`);
  // Real clicks while someone hums quietly underneath are still found.
  const h = heard({ delay: 0.09 });
  for (let i = 0; i < h.recorded.length; i++) h.recorded[i] += 0.004 * Math.sin((2 * Math.PI * 150 * i) / sr);
  const ok = findClickDelay(h.recorded, sr, h.times, h.recordStart);
  assert.ok(ok.sure && Math.abs(ok.seconds - 0.09) < 0.0005, `${ok.seconds}`);
});

test("delay: a buzzy sung voice never gives a false reading, wherever the clicks fall", () => {
  // Sharp edges once per cycle used to look like a click 3 ms late.
  const { times } = clickTrain(sr);
  const n = sr * 8;
  let wrong = 0;
  for (let off = 0; off < 2; off += 0.05) {
    const x = noise(n, 0.0015, 3);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr + off;
      if (t % 2 >= 1.5) continue;
      phase += (2 * Math.PI * 247) / sr;
      let v = 0;
      for (let h = 1; h < 12; h++) v += Math.sin(h * phase) / h ** 1.3;
      x[i] += 0.25 * v;
    }
    if (findClickDelay(x, sr, times, 0).sure) wrong++;
  }
  assert.equal(wrong, 0, `${wrong} false readings of 40`);
});

test("align: a take recorded 0.9 s before the beat, with 120 ms delay, starts exactly on the beat", () => {
  // Recorder started at 10.0 s; beat started at 10.9 s; delay 0.12 s.
  const rec = new Float32Array(sr * 3);
  const at = Math.round((10.9 + 0.12 - 10.0) * sr); // where the first sung beat lands
  rec[at] = 1;
  const take = alignTake(rec, sr, { recordStart: 10.0, beatStartTime: 10.9, latency: 0.12 });
  assert.equal(take[0], 1, "first sample is the first beat");
  // Recorder started late (after the beat): silence is added in front.
  const late = alignTake(new Float32Array(100).fill(0.5), sr, { recordStart: 5.01, beatStartTime: 5.0, latency: 0 });
  assert.equal(late.length, 100 + 480);
  assert.equal(late[479], 0);
  assert.equal(late[480], 0.5);
});

test("chunks: joined by their timestamps; a missing chunk becomes silence, timing kept", () => {
  const c = (frame, v) => ({ frame, data: new Float32Array(128).fill(v) });
  const { samples, firstFrame } = joinChunks([c(1000, 1), c(1128, 2), c(1384, 4)]);
  assert.equal(firstFrame, 1000);
  assert.equal(samples.length, 512);
  assert.equal(samples[127], 1);
  assert.equal(samples[128], 2);
  assert.equal(samples[256], 0, "the missing chunk");
  assert.equal(samples[384], 4);
  assert.equal(joinChunks([]).samples.length, 0);
});

test("gate: room noise between phrases goes down, the singing is untouched", () => {
  const n = sr * 3;
  const x = noise(n, 0.004, 7);
  // 1 s of "singing" in the middle.
  for (let i = sr; i < 2 * sr; i++) x[i] += 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr);
  const floor = noiseFloorDb(x, sr);
  assert.ok(floor < -45 && floor > -60, `floor ${floor.toFixed(1)} dB`);
  const settings = gateSettings(40, floor);
  const y = gate(x, sr, settings);
  const rms = (a, from, to) => Math.sqrt(a.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  const gapDrop = 20 * Math.log10(rms(y, 0.2 * sr, 0.8 * sr) / rms(x, 0.2 * sr, 0.8 * sr));
  assert.ok(Math.abs(gapDrop - settings.rangeDb) < 1, `gap turned down ${gapDrop.toFixed(1)} dB (wanted ${settings.rangeDb})`);
  const sungChange = 20 * Math.log10(rms(y, 1.1 * sr, 1.9 * sr) / rms(x, 1.1 * sr, 1.9 * sr));
  assert.ok(Math.abs(sungChange) < 0.1, `singing changed ${sungChange.toFixed(2)} dB`);
  assert.equal(gateSettings(0, floor), null, "Clean 0 = no gate");
});

test("reverb: fades by about 60 dB over its length, left and right differ", () => {
  const [l, r] = makeImpulse(sr, { seconds: 1.8 });
  const part = (a, t0, t1) => Math.sqrt(a.slice(Math.round(t0 * sr), Math.round(t1 * sr)).reduce((s, v) => s + v * v, 0));
  const early = part(l, 0.05, 0.15);
  const late = part(l, 1.7, 1.8);
  const drop = 20 * Math.log10(late / early);
  assert.ok(drop < -45 && drop > -70, `tail drops ${drop.toFixed(1)} dB`);
  let same = 0;
  for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same++;
  assert.ok(same < l.length * 0.1, "stereo");
});

test("knobs: Dry changes nothing; Smooth compresses; echo follows the beat", () => {
  const dry = chainParams(PRESETS.dry.knobs, 128);
  assert.equal(dry.comp, null);
  assert.equal(dry.reverb, 0);
  assert.equal(dry.echo.level, 0);
  assert.equal(dry.mud.gainDb === 0 || Object.is(dry.mud.gainDb, -0), true);
  const big = chainParams(PRESETS.big.knobs, 128);
  assert.ok(big.comp.ratio > 2 && big.comp.threshold < -15);
  assert.ok(Math.abs(big.echo.time - 0.75 * (60 / 128)) < 1e-9, "dotted eighth at 128");
  for (const p of Object.values(PRESETS)) for (const k of KNOBS) assert.ok(p.knobs[k.id] >= k.min && p.knobs[k.id] <= k.max, `${p.label} ${k.id}`);
});

test("auto level: the vocal sits 1 dB above the beat, within sensible limits", () => {
  assert.equal(autoVocalDb(-24, -10), 15);
  assert.equal(autoVocalDb(-50, -8), 24, "never more than +24 dB");
  assert.equal(autoVocalDb(-Infinity, -10), 0);
});

test("rumble cut: 30 Hz down a lot, 1 kHz untouched", () => {
  const tone = (hz) => new Float32Array(sr * 2).map((_, i) => Math.sin((2 * Math.PI * hz * i) / sr));
  const rms = (a) => Math.sqrt(a.slice(sr).reduce((s, v) => s + v * v, 0) / sr);
  const low = 20 * Math.log10(rms(highpass(tone(30), sr, 80)) / rms(tone(30)));
  const mid = 20 * Math.log10(rms(highpass(tone(1000), sr, 80)) / rms(tone(1000)));
  assert.ok(low < -15, `30 Hz: ${low.toFixed(1)} dB`);
  assert.ok(Math.abs(mid) < 0.1, `1 kHz: ${mid.toFixed(2)} dB`);
});

test("smooth: a loud word comes down by the ratio, quiet ones are left alone", () => {
  const tone = (amp) => new Float32Array(sr).map((_, i) => amp * Math.sin((2 * Math.PI * 300 * i) / sr));
  const peak = (a) => a.slice(sr / 2).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const settings = { threshold: -20, ratio: 4, knee: 0 };
  // −6 dB peak is 14 dB over: comes out 14/4 = 3.5 dB over, i.e. about −16.5 dB.
  const loud = 20 * Math.log10(peak(compress(tone(0.5), sr, settings)));
  assert.ok(Math.abs(loud - -16.5) < 1, `loud word ${loud.toFixed(1)} dB`);
  const quiet = 20 * Math.log10(peak(compress(tone(0.03), sr, settings)) / 0.03);
  assert.ok(Math.abs(quiet) < 0.05, `quiet word changed ${quiet.toFixed(2)} dB`);
});
