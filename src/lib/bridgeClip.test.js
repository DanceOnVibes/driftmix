// Bridges (clips between tracks) tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { trimClip, loopClip, bridgeDue, clipBpmFromName, BRIDGE_BARS } from "./bridgeClip.js";

const SR = 44100;

test("trim: whole bars from the first downbeat, 16 / 8 / 4, never part of a bar", () => {
  const bar = (60 * 4) / 128; // 1.875 s
  assert.deepEqual(trimClip(15.2, { bpm: 128, firstBeat: 0.01 }), { start: 0.01, bars: 8, end: 0.01 + 8 * bar });
  assert.equal(trimClip(10, { bpm: 128, firstBeat: 0 }).bars, 4, "10 s at 128 is 5⅓ bars → 4");
  assert.equal(trimClip(31, { bpm: 128, firstBeat: 0 }).bars, 16);
  assert.equal(trimClip(5, { bpm: 128, firstBeat: 0 }), null, "under 4 bars: no");
  // A first "downbeat" found a bar, or a beat, late moves back to the start.
  assert.ok(Math.abs(trimClip(16, { bpm: 128, firstBeat: bar + 0.02 }).start - 0.02) < 1e-9);
  assert.equal(trimClip(15.4, { bpm: 128, firstBeat: 60 / 128 + 0.01 }).bars, 8, "a beat late: still 8 bars");
  assert.equal(trimClip(16, { bpm: null, firstBeat: 0 }), null);
});

test("loop: the clip repeated to the bridge length, kicks exactly a bar apart across every join", () => {
  const bpm = 128;
  const beat = (60 / bpm) * SR;
  const x = new Float32Array(Math.round(8 * 4 * beat) + 500);
  for (let b = 0; b < 32; b++) {
    const at = Math.round(b * beat);
    for (let i = 0; i < 3000 && at + i < x.length; i++) x[at + i] += 0.8 * Math.exp(-i / 800) * Math.sin((2 * Math.PI * 60 * i) / SR);
  }
  const trim = trimClip(x.length / SR, { bpm, firstBeat: 0 });
  const [y] = loopClip([x], SR, trim, BRIDGE_BARS);
  assert.equal(trim.bars, 8);
  assert.ok(Math.abs(y.length - 3 * Math.round(8 * 4 * beat)) <= 3, `${y.length} samples = 24 bars`);
  // A kick starts at every beat (rising edge right after the beat), never in between.
  for (let b = 1; b < 96; b++) {
    const at = Math.round(b * beat);
    assert.ok(Math.abs(y[at + 30]) > 0.05, `kick ${b} there`);
    assert.ok(Math.abs(y[at - Math.round(0.2 * SR)]) < 0.05, `quiet before kick ${b}`);
  }
});

test("when a bridge plays", () => {
  assert.equal(bridgeDue("every", "8A", "9A"), true);
  assert.equal(bridgeDue("clash", "8A", "9A"), false, "neighbours blend fine");
  assert.equal(bridgeDue("clash", "8A", "3B"), true, "clashing keys get a bridge");
  assert.equal(bridgeDue("clash", null, "3B"), false, "unknown key: no reason to");
  assert.equal(bridgeDue("off", "8A", "3B"), false);
});

test("a tempo in the clip's name", () => {
  assert.equal(clipBpmFromName("Bridge 03 – drums 128.wav"), 128);
  assert.equal(clipBpmFromName("riser_126bpm_v2.wav"), 126);
  assert.equal(clipBpmFromName("Perc loop 124 BPM.mp3"), 124);
  assert.equal(clipBpmFromName("Bridge 07 - riser.wav"), null);
  assert.equal(clipBpmFromName("Bridge 07.wav"), null, "a clip number isn't a tempo");
});
