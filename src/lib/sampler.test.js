// Sample maker tests: on the beat, exact lengths, no clicks, pads in time. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { snapTo, sampleRange, cutSample, highpass, nextBeatTime, sampleName } from "./sampler.js";

const t128 = { bpm: 128, firstBeat: 0.12 };

test("snap: to the nearest beat, half beat or bar of the track's own grid", () => {
  const beat = 60 / 128;
  assert.ok(Math.abs(snapTo(10, t128, 1) - (0.12 + Math.round((10 - 0.12) / beat) * beat)) < 1e-12);
  assert.ok(Math.abs(snapTo(0.12 + 3.4 * beat, t128, 0.5) - (0.12 + 3.5 * beat)) < 1e-12);
  assert.ok(Math.abs(snapTo(0.12 + 5 * beat, t128, 4) - (0.12 + 4 * beat)) < 1e-12);
  assert.ok(snapTo(0.01, { bpm: 128, firstBeat: 0.3 }, 1) >= 0, "never before the start of the track");
});

test("range: a 4-beat sample at 128 BPM is exactly 90000 samples at 48 kHz, wherever it starts", () => {
  for (const start of [1.0001, 7.3, 33.33333]) {
    const r = sampleRange({ start, beats: 4, bpm: 128, sampleRate: 48000, length: 48000 * 240 });
    assert.equal(r.frames, 90000);
  }
  const end = sampleRange({ start: 239, beats: 4, bpm: 128, sampleRate: 48000, length: 48000 * 240 });
  assert.equal(end.from + end.frames, 48000 * 240, "near the end it slides back to fit");
});

test("cut: tiny fades so a loop never clicks; the middle is untouched", () => {
  const sr = 48000;
  const x = new Float32Array(sr).fill(0.5);
  const [y] = cutSample([x], 1000, 24000, { sampleRate: sr });
  assert.equal(y.length, 24000);
  assert.equal(y[0], 0);
  assert.ok(Math.abs(y[y.length - 1]) < 0.03);
  assert.equal(y[12000], 0.5);
});

test("cut bass and kick: 50 Hz down a lot, a 1 kHz voice untouched, settled from the first sample", () => {
  const sr = 48000;
  const tone = (hz) => Float32Array.from({ length: sr * 2 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / sr));
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const [low] = cutSample([tone(50)], sr, sr / 2, { sampleRate: sr, cutLowHz: 250 });
  const [mid] = cutSample([tone(1000)], sr, sr / 2, { sampleRate: sr, cutLowHz: 250 });
  assert.ok(20 * Math.log10(rms(low) / Math.SQRT1_2) < -40, "50 Hz cut by more than 40 dB");
  assert.ok(Math.abs(20 * Math.log10(rms(mid) / Math.SQRT1_2)) < 0.2, "1 kHz kept");
  // Settled: the cut matches the same filter run over the whole track.
  const whole = highpass(tone(1000), sr, 250);
  let worst = 0;
  for (let i = 100; i < 2000; i++) worst = Math.max(worst, Math.abs(mid[i] - whole[sr + i]));
  assert.ok(worst < 1e-3, `no start-up wobble (${worst})`);
  assert.equal(highpass(new Float32Array(10), sr, 250).length, 10);
});

test("pads land on the next beat of the playing track (or the next half beat)", () => {
  const beat = 60 / 128;
  // Playing at its own speed, 10.0 s into the track at context time 50.
  const at = nextBeatTime({ now: 50, position: 10, speed: 1, ...t128 }, 1);
  const trackAt = 10 + (at - 50);
  assert.ok(Math.abs(((trackAt - 0.12) / beat) % 1) < 1e-9 || Math.abs(((trackAt - 0.12) / beat) % 1 - 1) < 1e-9, "on a beat");
  assert.ok(at > 50 && at - 50 <= beat + 0.03);
  // Sped up 2%: real time shrinks.
  const fast = nextBeatTime({ now: 0, position: 0.12 + 0.5 * beat, speed: 1.02, ...t128 }, 1);
  assert.ok(Math.abs(fast - (0.5 * beat) / 1.02) < 1e-9);
  // Right on a beat: too close to make, so the one after.
  const close = nextBeatTime({ now: 0, position: 0.12 + 4 * beat - 0.001, speed: 1, ...t128 }, 1);
  assert.ok(Math.abs(close - (beat + 0.001)) < 1e-9);
});

test("names: track, length, tempo and key, safe for any USB stick", () => {
  assert.equal(sampleName({ title: "Vortex", beats: 4, bpm: 134, camelot: "9B" }), "Vortex - 4 beats - 134 BPM 9B.wav");
  assert.equal(sampleName({ title: "Light: in/the Dark", beats: 0.5, bpm: 132.04, camelot: null }), "Light in the Dark - half beat - 132 BPM.wav");
  assert.equal(sampleName({ title: "A", beats: 1, bpm: 128.25, camelot: "8A" }), "A - 1 beat - 128.3 BPM 8A.wav");
});
