// The mix card's content. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardLayout } from "./mixCard.js";

const e = (at, name, camelot, bpm) => ({ at, name, camelot, bpm });

test("a short set: every track, its time and key; the key path and tempo ladder", () => {
  const c = cardLayout([e(0, "Dracula's Land", "8A", 130), e(212.4, "Turn It Up", "8B", 130), e(431, "Age Is Just A Number", "9B", 132.02)], 640);
  assert.equal(c.length, "10:40");
  assert.equal(c.tracks, 3);
  assert.equal(c.tempo, "130 → 132 BPM");
  assert.deepEqual(c.keyPath, ["8A", "8B", "9B"]);
  assert.deepEqual(c.lines[1], { time: "03:32", name: "Turn It Up", key: "8B" });
  assert.equal(c.more, 0);
  assert.equal(c.size, 40);
});

test("one tempo all the way; repeated keys show once", () => {
  const c = cardLayout([e(0, "A", "5A", 128), e(100, "B", "5A", 128), e(200, "C", "6A", 128)], 300);
  assert.equal(c.tempo, "128 BPM");
  assert.deepEqual(c.keyPath, ["5A", "6A"]);
});

test("a long set: smaller type, then +N more; long key paths keep start and end; hour stamps line up", () => {
  const list = Array.from({ length: 25 }, (_, i) => e(i * 200, `Track ${i + 1}`, `${(i % 12) + 1}A`, 124 + i * 0.25));
  const c = cardLayout(list, 5100);
  assert.equal(c.size, 32);
  assert.equal(c.lines.length, 16);
  assert.equal(c.more, 9);
  assert.equal(c.keyPath.length, 12);
  assert.equal(c.keyPath[10], "…");
  assert.equal(c.keyPath[11], "1A", "the last key of the set");
  assert.equal(c.lines[0].time, "0:00:00");
  assert.equal(c.length, "1:25:00");
  assert.equal(c.tempo, "124 → 130 BPM");
});

test("nothing known: no tempo, no key path, still a card", () => {
  const c = cardLayout([e(0, "Only one", null, null)], 90);
  assert.equal(c.tempo, "");
  assert.deepEqual(c.keyPath, []);
  assert.equal(c.lines[0].key, "");
});
