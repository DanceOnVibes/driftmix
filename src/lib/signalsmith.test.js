// Studio time-stretch (Signalsmith Stretch) tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSignalsmith, signalsmithStretch } from "./signalsmith.js";
import { vocoderStretch } from "./vocoder.js";
import { timeStretch, useStudioStretch, stretchEngine } from "./stretch.js";
import { retune } from "./files/retune.js";
import { synthTrack } from "./test-synth.js";
import { analyzeTrack } from "./analyze.js";

const M = await loadSignalsmith();

/** Where a hit starts: the first sample above a quarter of the loudest nearby. */
function onset(y, around) {
  let most = 0;
  for (let i = around - 4000; i < around + 4000; i++) most = Math.max(most, Math.abs(y[i]));
  for (let i = around - 4000; i < around + 4000; i++) if (Math.abs(y[i]) > most * 0.25) return i;
  return -1;
}

test("studio stretch: exact length, and every hit lands where the beat grid expects it (within 1.5 ms)", () => {
  for (const sr of [44100, 48000]) {
    const x = new Float32Array(sr * 6);
    const times = [0.5, 2, 3.5, 5];
    for (const t of times) {
      const s = Math.round(t * sr);
      for (let i = 0; i < 3000; i++) x[s + i] = 0.8 * Math.exp(-i / 500) * Math.sin(i * 0.37) * Math.sin(i * 0.011 + 1);
    }
    for (const tempo of [0.94, 0.97, 1.03, 1.06]) {
      const [y] = signalsmithStretch(M, [x], sr, tempo);
      assert.equal(y.length, Math.ceil(x.length / tempo));
      for (const t of times) {
        const want = onset(x, Math.round(t * sr)) / tempo;
        const off = (onset(y, Math.round(want)) - want) / sr;
        assert.ok(Math.abs(off) < 0.0015, `${sr} Hz, ×${tempo}, hit at ${t}s: ${(off * 1000).toFixed(2)} ms out`);
      }
    }
  }
});

test("studio stretch keeps pitch: 440 Hz is still 440 Hz at 6% faster", () => {
  const sr = 44100;
  const tone = new Float32Array(sr * 3).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
  const [out] = signalsmithStretch(M, [tone], sr, 1.06);
  let crossings = 0;
  for (let i = sr / 2; i < out.length - sr / 2; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
  const hz = crossings / ((out.length - sr) / sr);
  assert.ok(Math.abs(hz - 440) < 2, `${hz.toFixed(1)} Hz`);
});

test("studio stretch: a held chord is cleaner than the vocoder's", () => {
  const sr = 48000;
  const notes = [110, 220, 261.63, 329.63, 440];
  const freqs = [];
  for (const f of notes) for (let h = 1; h < 8; h++) freqs.push(f * h);
  const x = new Float32Array(sr * 4);
  for (let i = 0; i < x.length; i++) {
    let v = 0;
    for (const f of notes) for (let h = 1; h < 8; h++) v += Math.sin(2 * Math.PI * f * h * (i / sr) + h) / h / 6;
    x[i] = 0.1 * v;
  }
  const rough = (y) => {
    const seg = y.subarray(sr, sr * 3);
    let on = 0;
    let off = 0;
    for (let f = 50; f < 4000; f += 2) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < seg.length; i += 2) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / seg.length);
        re += seg[i] * w * Math.cos((2 * Math.PI * f * i) / sr);
        im -= seg[i] * w * Math.sin((2 * Math.PI * f * i) / sr);
      }
      const p = re * re + im * im;
      if (freqs.some((n) => Math.abs(n - f) < 4)) on += p;
      else off += p;
    }
    return 10 * Math.log10(off / (on + off));
  };
  const studio = rough(signalsmithStretch(M, [x], sr, 0.97)[0]);
  const vocoder = rough(vocoderStretch([x], sr, 0.97)[0]);
  assert.ok(studio < -50, `studio: ${studio.toFixed(1)} dB`);
  assert.ok(studio < vocoder, `studio ${studio.toFixed(1)} dB vs vocoder ${vocoder.toFixed(1)} dB`);
});

test("studio stretch: stereo stays stereo (left and right not mixed together)", () => {
  const sr = 44100;
  const L = new Float32Array(sr * 2).map((_, i) => 0.4 * Math.sin((2 * Math.PI * 220 * i) / sr));
  const R = new Float32Array(sr * 2);
  const [a, b] = signalsmithStretch(M, [L, R], sr, 1.04);
  let l = 0;
  let r = 0;
  for (let i = 0; i < a.length; i++) {
    l += a[i] ** 2;
    r += b[i] ** 2;
  }
  assert.ok(10 * Math.log10(r / l) < -40, `right side: ${(10 * Math.log10(r / l)).toFixed(1)} dB`);
});

test("studio stretch: tiny clips (sampler pads) come out the right length, no glitches", () => {
  const sr = 44100;
  const x = new Float32Array(Math.round(sr * 0.2)).map((_, i) => 0.5 * Math.sin(i / 10));
  const [y] = signalsmithStretch(M, [x], sr, 0.95);
  assert.equal(y.length, Math.ceil(x.length / 0.95));
  assert.ok(y.every(Number.isFinite));
});

test("switched on, timeStretch and the key shift use it, and the reading stays right (130 → 129.6, D minor; +1 → 2A)", () => {
  useStudioStretch(M);
  try {
    assert.equal(stretchEngine(), "signalsmith");
    const t = synthTrack({ bpm: 130, root: 2, mode: "minor", seconds: 30 });
    const [out] = timeStretch([t.samples], t.sampleRate, 129.6 / 130);
    const r = analyzeTrack(out, t.sampleRate);
    assert.ok(Math.abs(r.tempo.bpm - 129.6) <= 0.1, `reads ${r.tempo.bpm}`);
    assert.equal(r.key.camelot, "7A");
    const [up] = retune([t.samples], t.sampleRate, { tempo: 1, semitones: 1 });
    const u = analyzeTrack(up, t.sampleRate);
    assert.equal(u.key.camelot, "2A", "D minor + 1 = D# minor (2A)");
    assert.ok(Math.abs(u.tempo.bpm - 130) <= 0.1, `tempo kept: ${u.tempo.bpm}`);
  } finally {
    useStudioStretch(null);
  }
  assert.equal(stretchEngine(), "vocoder");
});
