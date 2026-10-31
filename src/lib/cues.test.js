// Hot cues and loops tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { quantize, jumpTarget, loopAt, resizeLoop, wrapPosition, cueKey } from "./cues.js";

const t = { bpm: 120, firstBeat: 0.2 }; // a beat is 0.5 s

test("hot cue: set on the nearest beat; without a tempo, exactly where it is", () => {
  assert.ok(Math.abs(quantize(10.1, t) - 10.2) < 1e-12);
  assert.ok(Math.abs(quantize(10.4, t) - 10.2) < 1e-12);
  assert.ok(Math.abs(quantize(10.46, t) - 10.7) < 1e-12);
  assert.equal(quantize(3.33, null), 3.33);
  assert.ok(quantize(0.01, { bpm: 120, firstBeat: 0.4 }) >= 0);
});

test("jump: lands as far into the cue's beat as the playhead was into its own", () => {
  // Playhead 0.1 s into a beat; cue on a beat at 30.2: lands at 30.3.
  assert.ok(Math.abs(jumpTarget(50.3, 30.2, t, true) - 30.3) < 1e-9);
  assert.equal(jumpTarget(50.3, 30.2, t, false), 30.2, "paused: right on the cue");
  assert.equal(jumpTarget(50.3, 30.2, null, true), 30.2, "no tempo: right on the cue");
});

test("loop: starts on the beat the playhead is in, whole beats long; ½ loops on the half beat", () => {
  const l = loopAt(10.45, t, 4);
  assert.ok(Math.abs(l.start - 10.2) < 1e-9 && Math.abs(l.end - 12.2) < 1e-9 && l.beats === 4);
  const h = loopAt(10.45, t, 0.5);
  assert.ok(Math.abs(h.start - 10.45) < 1e-9 || Math.abs(h.start - 10.2) < 1e-9);
  assert.ok(Math.abs(h.end - h.start - 0.25) < 1e-9);
  const h2 = loopAt(10.5, t, 0.5);
  assert.ok(Math.abs(h2.start - 10.45) < 1e-9, `half-beat grid: ${h2.start}`);
  const r = resizeLoop(l, t, 8);
  assert.ok(r.start === l.start && Math.abs(r.end - 14.2) < 1e-9);
});

test("wrap: inside the loop nothing changes; past the end it goes round", () => {
  const l = { start: 10, end: 12 };
  assert.equal(wrapPosition(11, l), 11);
  assert.ok(Math.abs(wrapPosition(12.5, l) - 10.5) < 1e-9);
  assert.ok(Math.abs(wrapPosition(17.25, l) - 11.25) < 1e-9);
  assert.equal(wrapPosition(30, null), 30);
});

test("cue key: the same track gives the same key", () => {
  assert.equal(cueKey("Vortex", 252.04), cueKey("Vortex", 252.01));
  assert.notEqual(cueKey("Vortex", 252), cueKey("Light", 252));
});
