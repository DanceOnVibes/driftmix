// DJ knob tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { eqGainDb, filterHz, echoSeconds, knobLabel, reverbImpulse, KILL_DB } from "./djmixer.js";

test("EQ knob: centre flat, right +6 dB, left curves down to a kill", () => {
  assert.equal(eqGainDb(0), 0);
  assert.equal(eqGainDb(1), 6);
  assert.equal(eqGainDb(-1), KILL_DB);
  assert.ok(eqGainDb(-0.5) > -12 && eqGainDb(-0.5) < -8, "half left: a dip (−10 dB)");
  for (let v = -1; v < 1; v += 0.05) assert.ok(eqGainDb(v + 0.05) >= eqGainDb(v) - 1e-9, "always rising");
  assert.equal(eqGainDb(5), 6, "clamped");
});

test("filter knob: centre open; left low-pass down to 200 Hz; right high-pass up to 6 kHz", () => {
  assert.deepEqual(filterHz(0), { lowpass: 22000, highpass: 10 });
  assert.deepEqual(filterHz(0.02), { lowpass: 22000, highpass: 10 }, "a small dead zone in the middle");
  assert.ok(Math.abs(filterHz(-1).lowpass - 200) < 1);
  assert.ok(Math.abs(filterHz(1).highpass - 6000) < 1);
  assert.ok(filterHz(-0.5).lowpass < 5000 && filterHz(-0.5).lowpass > 500);
  assert.equal(filterHz(-0.5).highpass, 10, "only one side at a time");
});

test("echo is timed to the beat; labels read like a mixer", () => {
  assert.ok(Math.abs(echoSeconds(128) - 0.3515625) < 1e-9);
  assert.equal(echoSeconds(null), 0.375);
  assert.equal(knobLabel("eq", -1), "−∞");
  assert.equal(knobLabel("eq", 0), "0 dB");
  assert.equal(knobLabel("eq", 1), "+6.0 dB");
  assert.equal(knobLabel("filter", 0), "off");
  assert.equal(knobLabel("filter", -1), "LP 200");
  assert.equal(knobLabel("filter", 1), "HP 6.0k");
  assert.equal(knobLabel("fx", 0.4), "40%");
});

test("reverb room: two ears, fades out, the same every time", () => {
  const a = reverbImpulse(48000, 1);
  const b = reverbImpulse(48000, 1);
  assert.equal(a.length, 2);
  assert.deepEqual(a[0].slice(0, 100), b[0].slice(0, 100));
  const energy = (x, from, to) => x.slice(from, to).reduce((s, v) => s + v * v, 0);
  assert.ok(energy(a[0], 0, 4800) > energy(a[0], 43200, 48000) * 50, "loud early, near silent late");
  assert.equal(a[0][47999] === 0 || Math.abs(a[0][47999]) < 1e-3, true);
});
