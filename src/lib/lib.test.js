// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePeaks } from "./peaks.js";
import { crossfadeGains, formatTime, pressCue, clamp } from "./mixer.js";

test("peaks keep the loudest values in each slice, averaged across channels", () => {
  const left = new Float32Array([0, 0.5, -0.25, 1, 0, -1, 0.2, 0.1]);
  const right = new Float32Array([0, 0.5, -0.25, 1, 0, -1, 0.2, 0.1]);
  const { min, max } = computePeaks([left, right], 2);
  assert.deepEqual(Array.from(max), [1, 0.20000000298023224]);
  assert.deepEqual(Array.from(min), [-0.25, -1]);
});

test("peaks handle silence, empty tracks and more bars than samples", () => {
  assert.equal(computePeaks([new Float32Array(0)], 10).max.length, 10);
  const tiny = computePeaks([new Float32Array([0.5, -0.5])], 6);
  assert.equal(tiny.max.length, 6);
  assert.ok(Array.from(tiny.max).every((v) => v >= 0));
});

test("crossfader: hard left is all A, hard right all B, middle is equal power", () => {
  const left = crossfadeGains(-1);
  assert.ok(Math.abs(left.a - 1) < 1e-9 && Math.abs(left.b) < 1e-9);
  const right = crossfadeGains(1);
  assert.ok(Math.abs(right.b - 1) < 1e-9 && Math.abs(right.a) < 1e-9);
  const mid = crossfadeGains(0);
  assert.ok(Math.abs(mid.a - Math.SQRT1_2) < 1e-9 && Math.abs(mid.b - Math.SQRT1_2) < 1e-9);
  // Equal power: a² + b² stays 1 everywhere, so loudness stays even.
  for (const p of [-1, -0.5, 0, 0.3, 1]) {
    const g = crossfadeGains(p);
    assert.ok(Math.abs(g.a ** 2 + g.b ** 2 - 1) < 1e-9);
  }
  assert.deepEqual(crossfadeGains(5), crossfadeGains(1));
  assert.deepEqual(crossfadeGains(Number.NaN), crossfadeGains(0));
});

test("time shows m:ss and h:mm:ss, never negative", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.9), "1:05");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(-3), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
});

test("cue: paused sets the cue point, playing jumps back and stops", () => {
  assert.deepEqual(pressCue({ playing: false, position: 42, cue: 0 }), { playing: false, position: 42, cue: 42 });
  assert.deepEqual(pressCue({ playing: true, position: 80, cue: 42 }), { playing: false, position: 42, cue: 42 });
});

test("clamp keeps values inside the range", () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
});
