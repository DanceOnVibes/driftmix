// Auto DJ set planning tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderSet, orderTracks, stepCost, fitsTempo, mixOutIn, mixOutPoint } from "./setlist.js";

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

test("a chosen set tempo: 128 keeps 124–135 tracks, the 140 opener can't start", () => {
  const { order, left, setBpm } = orderSet([t("open", 140, "4A"), t("a", 130, "8A"), t("b", 128, "9A"), t("c", 124, "8A")], 128);
  assert.equal(setBpm, 128);
  assert.equal(order[0].id, "a", "first track that fits starts");
  assert.deepEqual(left.map((o) => o.id), ["open"]);
});

test("mix-out point: last 8-bar phrase line that leaves room for the blend", () => {
  const beat = 60 / 128;
  const p = mixOutPoint({ firstBeat: 0.2, bpm: 128, duration: 240, bars: 16 });
  const beats = (p - 0.2) / beat;
  assert.ok(Math.abs(beats / 32 - Math.round(beats / 32)) < 1e-9, "on a phrase line");
  assert.ok(p + 64 * beat <= 240 - 4 * beat, "blend fits before the end");
  assert.ok(p + 32 * beat + 64 * beat > 240 - 4 * beat, "and it's the last such line");
  assert.equal(mixOutPoint({ firstBeat: 0.2, bpm: 128, duration: 20, bars: 16 }), null, "too short");
});

test("order by tempo: tempo first (slow → fast or fast → slow), keys only break near-ties", () => {
  const t = (id, bpm, camelot) => ({ id, bpm, camelot });
  // The album from the chat: keys alone would pair the 6B tracks; tempo first must not.
  const album = [t("mothers", 137.6, "6B"), t("door", 131.4, "6B"), t("heart", 133.7, "8A"), t("wave", 131.2, "2B"), t("angels", 144, "10B"), t("none", null, "8A")];
  const up = orderTracks(album, "tempo-up");
  assert.deepEqual(up.order.map((o) => o.id).slice(-3), ["heart", "mothers", "angels"]);
  for (let i = 1; i < up.order.length; i++) assert.ok(up.order[i].bpm >= up.order[i - 1].bpm - 1, "climbs (never drops more than 1 BPM)");
  assert.deepEqual(up.left.map((o) => o.id), ["none"], "no tempo: to the end");
  const down = orderTracks(album, "tempo-down");
  assert.equal(down.order[0].id, "angels");
  for (let i = 1; i < down.order.length; i++) assert.ok(down.order[i].bpm <= down.order[i - 1].bpm + 1, "falls");
});

test("order by keys at any tempo: nothing is left out for being too fast or slow", () => {
  const t = (id, bpm, camelot) => ({ id, bpm, camelot });
  const { order, left } = orderTracks([t("a", 124, "8A"), t("far", 150, "9A"), t("b", 128, "3B"), t("c", 131, "8A")], "keys");
  assert.equal(order.length, 4);
  assert.equal(left.length, 0);
  assert.equal(order[0].id, "a", "the first track stays first");
  assert.equal(stepCost(order[0], order[1]), 0, "a perfect key match next");
  assert.equal(order[order.length - 1].id, "b", "the clashing key goes last");
  // The locked-tempo set still leaves the far one out.
  assert.deepEqual(orderSet([t("a", 124, "8A"), t("far", 150, "9A")]).left.map((o) => o.id), ["far"]);
});
