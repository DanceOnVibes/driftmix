// Echo-out bridge, tempo journey and tracklist tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { planBridge, chooseMix, settlePoint, stamp, tracklistText } from "./bridge.js";
import { orderJourney } from "./setlist.js";

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test("bridge: starts on the next 8-bar phrase line; the drop is 2 bars later", () => {
  const now = { bpm: 128, firstBeat: 0.2, position: 50, speed: 1, duration: 240 };
  const p = planBridge(now);
  const beats = (p.startTrack - 0.2) / (60 / 128);
  assert.ok(near(beats / 32, Math.round(beats / 32)), `on a phrase line (${beats} beats)`);
  assert.ok(p.startTrack >= 50.5 && p.startTrack < 50.5 + 32 * (60 / 128));
  assert.ok(near(p.dropIn - p.startIn, 8 * (60 / 128)), "2 bars of echo");
  assert.equal(p.fits, true);
});

test("bridge: a stretched deck counts in real seconds; near the end it uses the next bar", () => {
  const b = planBridge({ bpm: 132, firstBeat: 0, position: 60, speed: 129.8 / 132, duration: 240 });
  assert.ok(near(b.beat, 60 / 129.8), "a beat as heard");
  const beat = 60 / 128;
  const end = planBridge({ bpm: 128, firstBeat: 0, position: 240 - 12 * beat, speed: 1, duration: 240 });
  assert.ok(near(((end.startTrack / beat) % 4 + 4) % 4, 0) || near(((end.startTrack / beat) % 4 + 4) % 4, 4), "on a bar line");
  assert.ok(end.startTrack <= 240 - 8 * beat + 1e-9, "the echo still fits");
});

test("choose: close tempos and friendly keys blend; too far bridges (or skips when the bridge is off)", () => {
  assert.equal(chooseMix({ nowBpm: 128, nowKey: "8A", nextBpm: 130, nextKey: "9A", bridge: true }).kind, "blend");
  const far = chooseMix({ nowBpm: 129.8, nowKey: "8A", nextBpm: 144, nextKey: "10B", bridge: true, setBpm: 129.8 });
  assert.equal(far.kind, "bridge");
  assert.equal(far.targetBpm, null, "Angels plays at its own 144");
  assert.match(far.why, /% apart/);
  assert.equal(chooseMix({ nowBpm: 129.8, nowKey: "8A", nextBpm: 144, nextKey: "10B", bridge: false }).kind, "skip");
  // Back from Angels (144) to a 130 track in a set locked at 129.8: bridge, then play at the set tempo.
  const back = chooseMix({ nowBpm: 144, nowKey: "10B", nextBpm: 130, nextKey: "8A", bridge: true, setBpm: 129.8 });
  assert.equal(back.kind, "bridge");
  assert.equal(back.targetBpm, 129.8);
});

test("choose: a key clash nothing can fix bridges; a fixable one blends", () => {
  // 8A → 3B: clash; a ±2 semitone shift can't reach a green key from there? check both ways.
  const clash = chooseMix({ nowBpm: 128, nowKey: "8A", nextBpm: 128, nextKey: "2B", bridge: true });
  assert.equal(clash.kind, "bridge", clash.why);
  assert.equal(clash.why, "keys clash");
  const fixable = chooseMix({ nowBpm: 128, nowKey: "8A", nextBpm: 128, nextKey: "1A", bridge: true }); // +1 semitone → 8A
  assert.equal(fixable.kind, "blend");
  assert.equal(chooseMix({ nowBpm: 128, nowKey: "8A", nextBpm: 128, nextKey: "2B", bridge: false }).kind, "blend", "bridge off: blend as before");
  assert.equal(chooseMix({ nowBpm: 128, nowKey: "8A", nextBpm: null, nextKey: "8A", bridge: true }).kind, "bridge", "no beat: bridge in");
});

test("journey: settles on the next 8-bar line at least 4 s ahead, not in the last phrase", () => {
  const phrase = 32 * (60 / 130);
  const p = settlePoint({ bpm: 130, firstBeat: 0.1, position: 20, speed: 128 / 130, duration: 200 });
  assert.ok(near(((p - 0.1) / phrase) % 1, 0, 1e-9) || near(((p - 0.1) / phrase) % 1, 1, 1e-9));
  assert.ok((p - 20) / (128 / 130) >= 4);
  assert.equal(settlePoint({ bpm: 130, firstBeat: 0, position: 200 - phrase * 1.2, speed: 1, duration: 200 }), null, "too near the end");
});

test("journey order: climbs by tempo; tracks within 1 BPM swap for smoother keys", () => {
  const t = (id, bpm, camelot) => ({ id, bpm, camelot });
  const { order, left } = orderJourney([t("c", 132, "9A"), t("a", 128, "8A"), t("b2", 130.5, "3A"), t("b1", 130, "9A"), t("d", 135, "10A"), t("x", null, "8A")]);
  assert.equal(order[0].id, "a");
  assert.equal(order[order.length - 1].id, "d");
  for (let i = 1; i < order.length; i++) assert.ok(order[i].bpm >= order[i - 1].bpm - 1, "never drops more than 1 BPM");
  assert.deepEqual(left.map((o) => o.id), ["x"]);
  // 128 8A → (130 9A, 130.5 3A) → 132 9A: 9A next to 8A is smoother first.
  assert.equal(order[1].id, "b1");
});

test("tracklist: times as YouTube reads them", () => {
  assert.equal(stamp(0), "00:00");
  assert.equal(stamp(245.9), "04:05");
  assert.equal(stamp(3753), "1:02:33");
  assert.equal(tracklistText([{ at: 0, name: "Inspiration" }, { at: 222.4, name: "Age Is Just a Number" }]), "00:00 Inspiration\n03:42 Age Is Just a Number");
  assert.equal(tracklistText([{ at: 0, name: "A" }, { at: 3700, name: "B" }]), "0:00:00 A\n1:01:40 B");
});
