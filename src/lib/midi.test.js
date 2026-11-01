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

test("XDJ-RX2 layout: found by name, every control points at a real target, no control used twice", async () => {
  const { PRESETS, presetFor, TARGETS: T } = await import("./midi.js");
  assert.equal(presetFor(["Pioneer DJ XDJ-RX2 MIDI"])?.id, "xdj-rx2");
  assert.equal(presetFor(["PIONEER DDJ-400"]), null);
  for (const p of PRESETS) {
    const ids = new Set(T.map((t) => t.id));
    for (const [target, key] of Object.entries(p.map)) {
      assert.ok(ids.has(target), `${p.id}: ${target} is a DriftMix function`);
      assert.match(key, /^(note|cc):\d{1,2}:\d{1,3}$/);
    }
    const keys = Object.values(p.map);
    assert.equal(new Set(keys).size, keys.length, `${p.id}: each control has one job`);
  }
  // Deck 1 play is note 0 on MIDI channel 1 (status byte 0x90): that's what the maker's list says.
  const { parseMidi, controlKey } = await import("./midi.js");
  assert.equal(controlKey(parseMidi([0x90, 0, 127])), PRESETS[0].map["play-a"]);
  assert.equal(controlKey(parseMidi([0x96, 2, 127])), PRESETS[0].map["hotcue3-b"]);
  assert.equal(controlKey(parseMidi([0xb4, 71, 127])), PRESETS[0].map["headphones-b"]);
});
