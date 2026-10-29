// Pitch correction tests, on synthetic singing. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPitch, correctionCurve, shiftPitch, targetNote, scaleFor, pitchStats } from "./pitch.js";

const sr = 48000;
const cents = (hz, ref) => 1200 * Math.log2(hz / ref);
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * A sung-like voice: a pulse-rich tone through two vowel "formants", following
 * `midiAt(t)`, with a little breath noise. Notes are separated by short gaps.
 */
function voice(seconds, midiAt, { gaps = [] } = {}) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  let phase = 0;
  let seed = 9;
  const formant = (f) => 1 / (1 + ((f - 700) / 250) ** 2) + 0.6 / (1 + ((f - 1200) / 300) ** 2) + 0.15;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    seed = (seed * 16807) % 2147483647;
    const breath = ((seed / 2147483647) * 2 - 1) * 0.002;
    if (gaps.some(([a, b]) => t >= a && t < b)) {
      out[i] = breath;
      continue;
    }
    const f = midiHz(midiAt(t));
    phase += (2 * Math.PI * f) / sr;
    let v = 0;
    for (let h = 1; h * f < 5000; h++) v += (Math.sin(h * phase) / h) * formant(h * f);
    out[i] = 0.3 * v + breath;
  }
  return out;
}

/** Median detected pitch between two times, as MIDI. */
function medianMidi(track, a, b) {
  const v = [];
  track.f0.forEach((hz, i) => {
    const t = track.start + i * track.hop;
    if (hz && t >= a && t < b) v.push(69 + 12 * Math.log2(hz / 440));
  });
  v.sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)];
}

/** Vibrato depth (cents, half peak-to-peak) between two times. */
function depth(track, a, b) {
  const v = [];
  track.f0.forEach((hz, i) => {
    const t = track.start + i * track.hop;
    if (hz && t >= a && t < b) v.push(1200 * Math.log2(hz / 440));
  });
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) * Math.SQRT2;
}

test("detect: a steady voice at 110, 220 and 440 Hz, to within 2 cents", () => {
  for (const m of [45, 57, 69]) {
    const tr = detectPitch(voice(1.5, () => m), sr);
    const got = medianMidi(tr, 0.2, 1.3);
    assert.ok(Math.abs(got - m) * 100 < 2, `${midiHz(m).toFixed(0)} Hz read ${((got - m) * 100).toFixed(2)} cents off`);
  }
});

test("detect: silence and breath noise have no note", () => {
  const tr = detectPitch(voice(2, () => 57, { gaps: [[0, 2]] }), sr);
  assert.equal(tr.f0.filter((v) => v > 0).length, 0);
});

test("detect: follows vibrato (5.5 Hz, ±40 cents)", () => {
  const tr = detectPitch(voice(2, (t) => 57 + 0.4 * Math.sin(2 * Math.PI * 5.5 * t)), sr);
  const dp = depth(tr, 0.2, 1.8);
  assert.ok(Math.abs(dp - 40) < 6, `depth ${dp.toFixed(1)} cents`);
});

test("target note: nearest note, the key only decides the unclear in-between moments", () => {
  const cMajor = scaleFor(0, "major");
  assert.equal(targetNote(69.2, cMajor), 69);
  assert.equal(targetNote(70.2, cMajor), 70, "A# sung clearly (20 cents off) is respected though it's not in C major");
  assert.equal(targetNote(69.6, cMajor), 69, "between A and A#: A, the one in the key");
  assert.equal(targetNote(69.6, null), 70, "chromatic: just the nearest");
  assert.deepEqual(scaleFor(9, "minor"), [9, 11, 0, 2, 4, 5, 7]);
});

test("curve: 30 cents flat → +30 cents at Tune 100, +15 at Tune 50, nothing at 0", () => {
  const tr = detectPitch(voice(1.5, () => 56.7), sr);
  const mid = (c) => c[Math.floor(c.length / 2)];
  assert.ok(Math.abs(mid(correctionCurve(tr, { amount: 100, speedMs: 200 })) - 0.3) < 0.02);
  assert.ok(Math.abs(mid(correctionCurve(tr, { amount: 50, speedMs: 200 })) - 0.15) < 0.01);
  assert.ok(correctionCurve(tr, { amount: 0, speedMs: 200 }).every((v) => v === 0));
});

test("shift: one semitone up lands on 233.08 Hz, length and timing unchanged", () => {
  const x = voice(1.5, () => 57, { gaps: [[0.7, 0.8]] });
  const tr = detectPitch(x, sr);
  const y = shiftPitch(x, sr, tr, new Float32Array(tr.f0.length).fill(1));
  assert.equal(y.length, x.length);
  const got = medianMidi(detectPitch(y, sr), 0.2, 0.6);
  assert.ok(Math.abs(got - 58) * 100 < 3, `${((got - 58) * 100).toFixed(2)} cents from A#3`);
  // The second phrase's sound starts on exactly the same sample as before.
  const onset = (sig) => {
    for (let i = Math.round(0.75 * sr); i < sig.length; i++) if (Math.abs(sig[i]) > 0.05) return i;
    return -1;
  };
  assert.equal(onset(y), onset(x), "same start");
  // And sample by sample: outside the sung notes nothing changed at all.
  for (let i = Math.round(0.72 * sr); i < Math.round(0.78 * sr); i++) assert.equal(y[i], x[i]);
});

test("tune: off-key notes come in to within 5 cents; slow speed keeps the vibrato, fast removes it", () => {
  // Four notes, each 25–40 cents off, with natural vibrato.
  const notes = [
    [0.0, 57.3],
    [0.8, 59.65],
    [1.6, 60.25],
    [2.4, 61.6],
  ];
  const midiAt = (t) => {
    const n = notes.filter(([s]) => s <= t).pop();
    return n[1] + 0.25 * Math.sin(2 * Math.PI * 5.5 * t);
  };
  const gaps = notes.slice(1).map(([s]) => [s - 0.06, s]);
  const x = voice(3.2, midiAt, { gaps });
  const tr = detectPitch(x, sr);
  const before = pitchStats(tr);
  const scale = scaleFor(9, "minor");
  const slow = shiftPitch(x, sr, tr, correctionCurve(tr, { amount: 100, speedMs: 250, scale }));
  const ts = detectPitch(slow, sr);
  for (const [s, m] of notes) {
    const got = medianMidi(ts, s + 0.2, s + 0.6);
    assert.ok(Math.abs(got - Math.round(m)) * 100 < 5, `note ${m}: now ${((got - Math.round(m)) * 100).toFixed(1)} cents off`);
  }
  const keep = depth(ts, 0.1, 0.65) / depth(tr, 0.1, 0.65);
  assert.ok(keep > 0.7, `slow keeps ${(keep * 100).toFixed(0)}% of the vibrato`);
  const fast = detectPitch(shiftPitch(x, sr, tr, correctionCurve(tr, { amount: 100, speedMs: 10, scale })), sr);
  const flat = depth(fast, 0.1, 0.65) / depth(tr, 0.1, 0.65);
  assert.ok(flat < 0.35, `fast leaves ${(flat * 100).toFixed(0)}% of the vibrato (robotic)`);
  const after = pitchStats(ts);
  assert.ok(before.meanCents > 25 && after.meanCents < before.meanCents / 2, `average ${before.meanCents.toFixed(0)} → ${after.meanCents.toFixed(0)} cents`);
});

test("stats: how in tune a take is", () => {
  const st = pitchStats(detectPitch(voice(1.5, () => 57.1), sr));
  assert.ok(Math.abs(st.meanCents - 10) < 2 && st.within25 > 0.95, JSON.stringify(st));
  assert.equal(pitchStats({ f0: new Float32Array(10), hop: 0.01 }), null);
});
