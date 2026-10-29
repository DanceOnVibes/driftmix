// Transition button tests: the plan maths and the time-stretch. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { planTransition, blendCurves, refinePlan } from "./transition.js";
import { timeStretch } from "./stretch.js";
import { synthTrack } from "./test-synth.js";
import { analyzeTrack } from "./analyze.js";

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// Adalbert's pair: Lost In The Rhythm (129.6) playing, The Light in the Dark (130.9) next.
const nowDeck = (o = {}) => ({ bpm: 129.6, firstBeat: 0.1, position: 60, speed: 1, duration: 217, ...o });
const nextDeck = (o = {}) => ({ bpm: 130.9, firstBeat: 0.25, cue: 0, duration: 201, ...o });

test("starts on the next bar of the playing track", () => {
  const p = planTransition({ now: nowDeck(), next: nextDeck(), bars: 16 });
  const beat = 60 / 129.6;
  const beatsFromFirst = (p.startTrack - 0.1) / beat;
  assert.ok(near(beatsFromFirst % 4, 0, 1e-6) || near(beatsFromFirst % 4, 4, 1e-6), "on a bar line");
  assert.ok(p.startIn >= 0.3 && p.startIn <= 0.3 + 4 * beat, `starts within one bar (${p.startIn.toFixed(2)}s)`);
});

test("next track is stretched to the playing tempo, key kept", () => {
  const p = planTransition({ now: nowDeck(), next: nextDeck(), bars: 16 });
  assert.ok(near(p.speed, 129.6 / 130.9));
  assert.equal(p.pitchRate, 1);
  assert.ok(near(p.stretchTempo, p.speed));
  assert.ok(near(p.nextBpm, 129.6));
  assert.equal(p.nextStart, 0.25, "comes in on its first beat when no cue is set");
});

test("16 bars at 129.6 BPM lasts 29.6 s; bass swap half way", () => {
  const p = planTransition({ now: nowDeck(), next: nextDeck(), bars: 16 });
  assert.ok(near(p.blendSeconds, (16 * 4 * 60) / 129.6));
  assert.ok(near(p.swapAt, p.blendSeconds / 2));
  assert.equal(p.bars, 16);
  assert.equal(p.fits, true);
});

test("a key shift changes pitch but the tempo still matches exactly", () => {
  const p = planTransition({ now: nowDeck(), next: nextDeck(), bars: 16, semitones: 1 });
  assert.ok(near(p.pitchRate, 2 ** (1 / 12)));
  assert.ok(near(p.pitchRate * p.stretchTempo, p.speed), "pitch × stretch = speed");
});

test("cue point: comes in on the beat nearest the cue", () => {
  const beat = 60 / 130.9;
  const p = planTransition({ now: nowDeck(), next: nextDeck({ cue: 0.25 + 32 * beat + 0.05 }), bars: 16 });
  assert.ok(near(p.nextStart, 0.25 + 32 * beat));
});

test("near the end of the playing track the blend shortens to fit", () => {
  const beat = 60 / 129.6;
  const p = planTransition({ now: nowDeck({ position: 217 - 10 * 4 * beat }), next: nextDeck(), bars: 32 });
  assert.ok(p.bars < 32 && p.bars >= 4, `shortened to ${p.bars} bars`);
});

test("a deck that was already stretched keeps its grid (track seconds vs real seconds)", () => {
  // Now deck: a 130.9 track playing at 129.6 after an earlier transition.
  const now = { bpm: 130.9, firstBeat: 0.25, position: 40, speed: 129.6 / 130.9, duration: 201 };
  const p = planTransition({ now, next: nextDeck({ bpm: 128 }), bars: 8 });
  const beatTrack = 60 / 130.9;
  const beatsFromFirst = (p.startTrack - 0.25) / beatTrack;
  assert.ok(near(beatsFromFirst / 4, Math.round(beatsFromFirst / 4), 1e-6), "on the now deck's bar line");
  assert.ok(near(p.speed, 129.6 / 128), "next matches what the audience hears (129.6)");
  assert.ok(near(p.blendSeconds, (8 * 4 * 60) / 129.6));
});

test("half time: a 64 BPM track against 128 plays at its own speed", () => {
  const p = planTransition({ now: nowDeck({ bpm: 128 }), next: nextDeck({ bpm: 64 }), bars: 8, factor: 2 });
  assert.ok(near(p.speed, 1));
});

test("blend curves: equal power, from the current level to silence and silence to full", () => {
  const c = blendCurves(101, 0.8);
  assert.ok(near(c.out[0], 0.8) && c.out[100] === 0);
  assert.ok(c.in[0] === 0 && c.in[100] === 1);
  assert.ok(near(c.in[50] ** 2 + (c.out[50] / 0.8) ** 2, 1, 1e-5));
});

test("time-stretch keeps pitch: a 440 Hz tone is still 440 Hz at 6% faster", () => {
  const sr = 44100;
  const tone = new Float32Array(sr * 3).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
  const [out] = timeStretch([tone], sr, 1.06);
  assert.ok(near(tone.length / out.length, 1.06, 0.001));
  let crossings = 0;
  for (let i = sr / 2; i < out.length - sr / 2; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
  const hz = crossings / ((out.length - sr) / sr);
  assert.ok(Math.abs(hz - 440) < 2, `${hz.toFixed(1)} Hz`);
});

test("time-stretch hits the target tempo and keeps the key (130 → 129.6, D minor)", () => {
  const t = synthTrack({ bpm: 130, root: 2, mode: "minor", seconds: 30 });
  const [out] = timeStretch([t.samples], t.sampleRate, 129.6 / 130);
  const r = analyzeTrack(out, t.sampleRate);
  assert.ok(Math.abs(r.tempo.bpm - 129.6) <= 0.1, `reads ${r.tempo.bpm}`);
  assert.equal(r.key.camelot, "7A");
});

test("phrase mode: starts on the next 8-bar line, not just the next bar", () => {
  const p = planTransition({ now: nowDeck(), next: nextDeck(), bars: 16, phraseBars: 8 });
  const beats = (p.startTrack - 0.1) / (60 / 129.6);
  assert.ok(near(beats / 32, Math.round(beats / 32), 1e-6), `on a 32-beat line (${beats.toFixed(2)} beats)`);
});

test("refine: snaps to the real local beats and corrects a small tempo error", () => {
  const plan = planTransition({ now: nowDeck(), next: nextDeck(), bars: 16 });
  // The local measurement says: now really 129.71, its beats sit 12 ms later; next really 130.85.
  const nowLocal = { bpm: 129.71, beat: 0.1 + 0.012 };
  const nextLocal = { bpm: 130.85, beat: 0.25 - 0.008 };
  const r = refinePlan(plan, { now: { bpm: 129.6, position: 60, speed: 1 }, next: { bpm: 130.9 }, nowLocal, nextLocal, prepared: plan.stretchTempo });
  const beatNow = 60 / 129.71;
  assert.ok(near(((r.startTrack - nowLocal.beat) / beatNow) % 1, 0, 1e-6) || near(((r.startTrack - nowLocal.beat) / beatNow) % 1, 1, 1e-6), "start on a real beat");
  assert.ok(near(r.speed, 129.71 / 130.85), "speed from the local tempos");
  assert.ok(near(r.stretchTempo * r.pitchRate, r.speed), "stretch × trim = speed");
  assert.ok(Math.abs(r.pitchRate - 1) < 0.006, "the trim is tiny");
  assert.equal(r.refined.speed, true);
});

test("refine: a big disagreement is not trusted for speed (keeps the plan)", () => {
  const plan = planTransition({ now: nowDeck(), next: nextDeck(), bars: 16 });
  const r = refinePlan(plan, { now: { bpm: 129.6, position: 60, speed: 1 }, next: { bpm: 130.9 }, nowLocal: { bpm: 133, beat: 0.1 }, nextLocal: null, prepared: plan.stretchTempo });
  assert.ok(near(r.speed, plan.speed));
  assert.equal(r.refined.speed, false);
});

test("stretch quality: a held chord stays clean (the 'pouring water' fix)", async () => {
  const { wsolaStretch } = await import("./stretch.js");
  const sr = 48000;
  const freqs = [];
  for (const f of [110, 220, 261.63, 329.63, 440]) for (let h = 1; h < 8; h++) freqs.push(f * h);
  const x = new Float32Array(sr * 4);
  for (let i = 0; i < x.length; i++) {
    let v = 0;
    for (const f of [110, 220, 261.63, 329.63, 440]) for (let h = 1; h < 8; h++) v += Math.sin(2 * Math.PI * f * h * (i / sr) + h) / h / 6;
    x[i] = 0.1 * v;
  }
  // Energy that isn't the chord's notes, from a plain DFT at 1 Hz steps up to 4 kHz.
  const rough = (y) => {
    const seg = y.subarray(sr, sr * 3);
    let notes = 0;
    let other = 0;
    for (let f = 50; f < 4000; f += 1) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < seg.length; i += 2) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / seg.length);
        re += seg[i] * w * Math.cos((2 * Math.PI * f * i) / sr);
        im -= seg[i] * w * Math.sin((2 * Math.PI * f * i) / sr);
      }
      const p = re * re + im * im;
      if (freqs.some((n) => Math.abs(n - f) < 4)) notes += p;
      else other += p;
    }
    return 10 * Math.log10(other / (notes + other));
  };
  const clean = rough(timeStretch([x], sr, 0.97)[0]);
  const old = rough(wsolaStretch([x], sr, 0.97)[0]);
  assert.ok(clean < -40, `new stretch: ${clean.toFixed(1)} dB`);
  assert.ok(clean < old - 15, `new ${clean.toFixed(1)} dB vs old ${old.toFixed(1)} dB`);
});

test("stretch: stereo in one pass gives the same as each side on its own (and keeps the image)", async () => {
  const { vocoderStretch } = await import("./vocoder.js");
  const sr = 48000;
  const L = new Float32Array(sr * 2).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr) + 0.1 * Math.sin((2 * Math.PI * 1100 * i) / sr));
  const R = new Float32Array(sr * 2).map((_, i) => 0.2 * Math.sin((2 * Math.PI * 330 * i) / sr));
  const [a, b] = vocoderStretch([L, R], sr, 1.04);
  const [c, d] = vocoderStretch([L, R, new Float32Array(L.length)], sr, 1.04); // three channels: no packing
  let e = 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    e += (a[i] - c[i]) ** 2 + (b[i] - d[i]) ** 2;
    s += c[i] ** 2 + d[i] ** 2;
  }
  assert.ok(10 * Math.log10(e / s + 1e-30) < -100, "identical");
  assert.equal(a.length, Math.ceil(L.length / 1.04));
});
