// Set types and the set length. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { SET_TYPES, STOP_AFTER, lastTrack } from "./setTypes.js";
import { ORDER_BY } from "./setlist.js";

test("every set type uses settings Auto DJ knows", () => {
  for (const [id, t] of Object.entries(SET_TYPES)) {
    if (!t.settings) continue;
    assert.ok(ORDER_BY[t.settings.orderBy], `${id}: order`);
    assert.ok(t.settings.tempoChoice === "first" || t.settings.tempoChoice === "journey", `${id}: tempo`);
    assert.ok([8, 16, 32].includes(t.settings.bars), `${id}: bars`);
    assert.ok(["off", "third", "every"].includes(t.settings.buildUps), `${id}: build-ups`);
    assert.ok(STOP_AFTER.includes(t.settings.stopAfter), `${id}: length`);
    assert.ok(t.label.includes(`${t.settings.stopAfter} min`), `${id}: the label says the length`);
  }
});

test("the set ends on the track that reaches the length, never cuts one short", () => {
  assert.equal(lastTrack(0, 5000, 300), false, "no limit: the whole playlist");
  assert.equal(lastTrack(30, 20 * 60, 4 * 60), false, "24 min by its end: another track");
  assert.equal(lastTrack(30, 25 * 60, 4 * 60), true, "29 min by its end: within a minute, the last one");
  assert.equal(lastTrack(30, 28 * 60, 5 * 60), true, "past 30: the last one");
});
