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
