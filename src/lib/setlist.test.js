// Auto DJ set planning tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSet, stepCost, fitsTempo, mixOutIn } from "./setlist.js";

const t = (id, bpm, camelot) => ({ id, bpm, camelot });

test("step costs: green free, fixable cheap, clash expensive", () => {
  assert.equal(stepCost(t("a", 128, "8A"), t("b", 128, "9A")), 0);
  assert.equal(stepCost(t("a", 128, "8A"), t("b", 128, "1A")), 2); // +1 semitone fixes it
  assert.equal(stepCost(t("a", 128, "8A"), t("b", 128, "10A")), 3); // amber
  assert.equal(stepCost(t("a", 128, null), t("b", 128, "8A")), 4);
});

test("orders a shuffled playlist into a smooth walk round the wheel", () => {
  const tracks = [t("start", 128, "8A"), t("x", 128, "11A"), t("y", 128, "9A"), t("z", 128, "10A")];
  const { order, cost } = orderSet(tracks);
  assert.equal(order[0].id, "start", "keeps the first track first");
  assert.deepEqual(order.map((o) => o.camelot), ["8A", "9A", "10A", "11A"]);
  assert.equal(cost, 0);
  // 8B only mixes cleanly with 8A (which must start), so one amber step is the best possible.
  const withB = orderSet([...tracks, t("w", 128, "8B")]);
  assert.equal(withB.cost, 3, withB.order.map((o) => o.camelot).join(" → "));
});

test("Adalbert's tracks: Lost In The Rhythm 8A, Light in the Dark 7A, Vortex 8A, UNTOLD 4A", () => {
  const tracks = [t("lost", 129.6, "8A"), t("untold", 131.5, "4A"), t("light", 130.9, "7A"), t("vortex", 129, "8A")];
  const { order, setBpm } = orderSet(tracks);
  assert.equal(setBpm, 129.6);
  assert.deepEqual(order.slice(0, 3).map((o) => o.id).sort(), ["light", "lost", "vortex"]);
  assert.equal(order[3].id, "untold", "the clashing key goes last, where it costs least");
});

test("tempo lock: tracks more than 6% from the first one are left out", () => {
  const { order, left } = orderSet([t("a", 128, "8A"), t("b", 124, "8A"), t("c", 140, "8A"), t("d", null, "8A")]);
  assert.deepEqual(order.map((o) => o.id), ["a", "b"]);
  assert.deepEqual(left.map((o) => o.id), ["c", "d"]);
  assert.equal(fitsTempo(t("e", 64, "8A"), 128), true, "half time fits");
});

test("enough tracks for a 30-minute set keep a low total cost", () => {
  const codes = ["8A", "3A", "9A", "5A", "10A", "8B", "4A", "7A", "11A", "6A"];
  const tracks = codes.map((c, i) => t(`t${i}`, 128, c));
  const { order, cost } = orderSet(tracks);
  assert.equal(order.length, 10);
  assert.ok(cost <= 6, `total cost ${cost}: ${order.map((o) => o.camelot).join(" → ")}`);
});

test("mix-out timing: starts mixing a blend plus prep time before the end", () => {
  const s = mixOutIn({ position: 0, duration: 200, speed: 1, bpm: 128, bars: 16, prep: 6 });
  assert.ok(Math.abs(s - (200 - 30 - 6)) < 1e-9);
  // A stretched deck plays its track faster, so less real time is left.
  const fast = mixOutIn({ position: 0, duration: 200, speed: 1.05, bpm: 128 / 1.05, bars: 16, prep: 6 });
  assert.ok(Math.abs(fast - (200 / 1.05 - 30 - 6)) < 1e-9);
});

test("empty and no-tempo playlists don't break", () => {
  assert.deepEqual(orderSet([]).order, []);
  assert.equal(orderSet([t("a", null, "8A")]).left.length, 1);
});
