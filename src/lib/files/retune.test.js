// Exact BPM and key shift tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { retunePlan, resample, retune, shiftKeyName } from "./retune.js";
import { synthTrack } from "../test-synth.js";
import { analyzeTrack } from "../analyze.js";
import { tempoSections, steadiness } from "../steady.js";
import { downsample } from "../analyze.js";

/** Frequency of a pure tone, from its upward zero crossings. */
function toneHz(x, sr) {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = sr; i < x.length - sr; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + -x[i - 1] / (x[i] - x[i - 1]);
      if (first < 0) first = t;
      else count++;
      last = t;
    }
  }
  return (count * sr) / (last - first);
}

test("plan: 132.1 → 131 BPM is 0.83% slower; key shift moves Camelot and name", () => {
  const p = retunePlan({ bpm: 132.1, camelot: "10B", keyName: "D major" }, { targetBpm: 131 });
  assert.ok(Math.abs(p.tempo - 131 / 132.1) < 1e-12);
  assert.ok(Math.abs(p.percent - -0.8327) < 0.001);
  assert.equal(p.bpm, 131);
  assert.equal(p.camelot, "10B");
  const up = retunePlan({ bpm: 134, camelot: "2B", keyName: "F# major" }, { semitones: 1 });
  assert.equal(up.camelot, "9B", "+1 semitone is 7 steps round the wheel");
  assert.equal(up.keyName, "G major");
  assert.equal(up.tempo, 1);
  assert.equal(shiftKeyName("Bb minor", -2), "Ab minor");
  assert.equal(shiftKeyName("A# minor", 2), "C minor");
});

test("plan: nothing asked, nothing changes", () => {
  const p = retunePlan({ bpm: 134, camelot: "11A", keyName: "F# minor" }, {});
  assert.equal(p.changed, false);
  assert.equal(p.bpm, 134);
  assert.equal(retunePlan({ bpm: 134.01 }, { targetBpm: 134 }).tempo, 1, "0.007% is left alone");
});

test("resample: one semitone up turns 440 Hz into 466.16 Hz, level kept", () => {
  const sr = 48000;
  const tone = new Float32Array(sr * 4).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
  const [out] = resample([tone], 2 ** (1 / 12));
  const hz = toneHz(out, sr);
  assert.ok(Math.abs(hz - 466.164) < 0.05, `${hz.toFixed(3)} Hz`);
  let peak = 0;
  for (let i = sr; i < out.length - sr; i++) peak = Math.max(peak, Math.abs(out[i]));
  assert.ok(Math.abs(peak - 0.5) < 0.005, `peak ${peak}`);
  assert.equal(out.length, Math.floor(tone.length / 2 ** (1 / 12)));
});

test("resample: going up, a tone that would land above the top is filtered out (no harsh fold-back)", () => {
  const sr = 44100;
  // 21 kHz × 1.12 = 23.6 kHz, above what 44.1 kHz can hold (22.05 kHz).
  const tone = new Float32Array(sr).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 21000 * i) / sr));
  const [out] = resample([tone], 2 ** (2 / 12));
  let rms = 0;
  for (let i = 2000; i < out.length - 2000; i++) rms += out[i] ** 2;
  rms = Math.sqrt(rms / (out.length - 4000));
  assert.ok(rms < 0.01, `left over ${rms.toFixed(4)} (was 0.35)`);
});

test("retune: a 130 BPM track in D minor (7A) comes out at exactly 128 BPM, +1 semitone = D# minor (2A)", () => {
  const t = synthTrack({ bpm: 130, root: 2, mode: "minor", seconds: 30 });
  const [out] = retune([t.samples], t.sampleRate, retunePlan({ bpm: 130, camelot: "7A" }, { targetBpm: 128, semitones: 1 }));
  assert.ok(Math.abs(t.samples.length / out.length - 128 / 130) < 0.002, "length follows the tempo");
  const r = analyzeTrack(out, t.sampleRate);
  assert.ok(Math.abs(r.tempo.bpm - 128) <= 0.1, `reads ${r.tempo.bpm}`);
  assert.equal(r.key.camelot, "2A");
});

test("retune: tempo only keeps the key", () => {
  const t = synthTrack({ bpm: 132.1, root: 2, mode: "major", seconds: 30 });
  const [out] = retune([t.samples], t.sampleRate, retunePlan({ bpm: 132.1 }, { targetBpm: 131 }));
  const r = analyzeTrack(out, t.sampleRate);
  assert.ok(Math.abs(r.tempo.bpm - 131) <= 0.1, `reads ${r.tempo.bpm}`);
  assert.equal(r.key.camelot, "10B");
});

test("steadiness: one tempo all through is steady; 130 then 140 wanders", () => {
  const steadyTrack = synthTrack({ bpm: 130, seconds: 96 });
  const d = downsample(steadyTrack.samples, steadyTrack.sampleRate);
  const s = steadiness(tempoSections(d.samples, d.sampleRate, 130));
  assert.equal(s.level, "steady");
  const a = synthTrack({ bpm: 130, seconds: 48 });
  const b = synthTrack({ bpm: 140, seconds: 48 });
  const joined = new Float32Array(a.samples.length + b.samples.length);
  joined.set(a.samples);
  joined.set(b.samples, a.samples.length);
  const j = downsample(joined, a.sampleRate);
  const w = steadiness(tempoSections(j.samples, j.sampleRate, 135));
  assert.equal(w.level, "wanders");
  assert.ok(Math.abs(w.min - 130) < 0.3 && Math.abs(w.max - 140) < 0.3, `${w.min}–${w.max}`);
  assert.equal(steadiness([]).level, "unknown");
});
