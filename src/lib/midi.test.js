// Controller (MIDI) tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMidi, controlKey, valueFor, controlLabel, TARGETS } from "./midi.js";

test("reads knobs and pads", () => {
  assert.deepEqual(parseMidi([0xb0, 7, 100]), { type: "cc", channel: 0, number: 7, value: 100 });
  assert.deepEqual(parseMidi([0x91, 36, 127]), { type: "note", channel: 1, number: 36, value: 127, down: true });
  assert.equal(parseMidi([0x91, 36, 0]).down, false, "note on with 0 = let go");
  assert.equal(parseMidi([0x81, 36, 64]).down, false);
  assert.equal(parseMidi([0xf8]), null, "clock ticks are ignored");
  assert.equal(parseMidi([0xe0, 0, 64]), null);
  assert.equal(controlKey(parseMidi([0xb2, 21, 5])), "cc:2:21");
  assert.equal(controlLabel("note:1:36"), "Note 36 · ch 2");
});

test("values: knobs centre on 0, faders 0…1, buttons press once", () => {
  const knob = { kind: "knob" };
  assert.equal(valueFor(knob, { type: "cc", value: 0 }), -1);
  assert.equal(valueFor(knob, { type: "cc", value: 127 }), 1);
  assert.equal(valueFor(knob, { type: "cc", value: 64 }), 0, "centre detent");
  assert.equal(valueFor(knob, { type: "cc", value: 63 }), 0);
  assert.equal(valueFor({ kind: "fader" }, { type: "cc", value: 127 }), 1);
  assert.equal(valueFor({ kind: "fx" }, { type: "cc", value: 0 }), 0);
  const button = { kind: "button" };
  assert.equal(valueFor(button, { type: "note", down: true, value: 100 }), "press");
  assert.equal(valueFor(button, { type: "note", down: false, value: 0 }), null);
  assert.equal(valueFor(button, { type: "cc", value: 127 }), "press");
  assert.equal(valueFor(button, { type: "cc", value: 0 }), null);
});

test("everything a DJ needs can be learned, once each", () => {
  const ids = TARGETS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const must of ["play-a", "cue-b", "low-a", "filter-b", "crossfader", "mix", "headphones-a", "hotcue4-b"]) assert.ok(ids.includes(must), must);
});
