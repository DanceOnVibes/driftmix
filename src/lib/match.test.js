// Match light tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyMatch, friendlyCodes, shiftCamelot, keyFixes, tempoMatch, assessMatch } from "./match.js";

const deck = (id, bpm, camelot, sure = true) => ({
  id,
  analysis: {
    status: "done",
    tempo: bpm == null ? null : { bpm, sure },
    key: camelot == null ? null : { camelot, sure },
  },
});

test("key: same, neighbour and A/B swap are green", () => {
  assert.equal(keyMatch("8A", "8A").level, "green");
  assert.equal(keyMatch("8A", "9A").level, "green");
  assert.equal(keyMatch("8A", "7A").level, "green");
  assert.equal(keyMatch("8A", "8B").level, "green");
  assert.equal(keyMatch("12A", "1A").level, "green", "the wheel wraps round from 12 to 1");
});

test("key: two steps and diagonals are amber, the rest red", () => {
  assert.deepEqual(keyMatch("8A", "10A"), { level: "amber", label: "Energy boost (+2)" });
  assert.deepEqual(keyMatch("8A", "6A"), { level: "amber", label: "Energy drop (−2)" });
  assert.equal(keyMatch("8A", "9B").level, "amber");
  assert.equal(keyMatch("8A", "2B").level, "red");
  assert.equal(keyMatch("7A", "1A").level, "red");
  assert.equal(keyMatch("8A", "?"), null);
});

test("friendly keys for 8A are 8A, 7A, 9A and 8B", () => {
  assert.deepEqual(friendlyCodes("8A"), ["8A", "7A", "9A", "8B"]);
  assert.deepEqual(friendlyCodes("1B"), ["1B", "12B", "2B", "1A"]);
});

test("semitone shifts move the right way round the wheel", () => {
  assert.equal(shiftCamelot("8A", 1), "3A"); // A minor → Bb minor
  assert.equal(shiftCamelot("8A", -1), "1A"); // A minor → Ab minor
  assert.equal(shiftCamelot("7A", 2), "9A"); // D minor → E minor
  assert.equal(shiftCamelot("8B", 12), "8B"); // a whole octave changes nothing
});

test("key fixes: smallest shift first, only ones that turn green", () => {
  // Playing 8A (A minor), next is 1A (Ab minor): one semitone up lands on 8A.
  assert.deepEqual(keyFixes("8A", "1A")[0], { semitones: 1, code: "8A" });
  // Playing 7A, next 9A: two semitones down lands on 7A.
  assert.ok(keyFixes("7A", "9A").some((f) => f.semitones === -2 && f.code === "7A"));
  for (const f of keyFixes("8A", "2B")) assert.equal(keyMatch("8A", f.code).level, "green");
});

test("tempo: 3% green, 6% amber, beyond red; half and double time count", () => {
  assert.equal(tempoMatch(128, 128).label, "Same tempo");
  assert.equal(tempoMatch(129, 129.6).level, "green");
  assert.equal(tempoMatch(128, 124).level, "amber"); // 3.2%
  assert.equal(tempoMatch(128, 133).level, "amber"); // 3.8%
  assert.equal(tempoMatch(128, 140).level, "red");
  const half = tempoMatch(128, 64);
  assert.equal(half.level, "green");
  assert.equal(half.factor, 2);
  assert.equal(tempoMatch(128, 0), null);
});

test("Adalbert's real pair: Vortex 129 / 8A and Lost In The Rhythm 129.6 / 8A is a good match", () => {
  const m = assessMatch(deck("a", 129, "8A"), deck("b", 129.6, "8A", true));
  assert.equal(m.level, "green");
  assert.equal(m.headline, "Good match");
  assert.match(m.tips.join(" "), /slow down B to 129 BPM/);
});

test("a clash gets a semitone fix and a list of friendly keys", () => {
  const m = assessMatch(deck("a", 128, "8A"), deck("b", 128, "1A"));
  assert.equal(m.level, "red");
  assert.match(m.tips.join(" "), /Shift B up 1 semitone \(1A → 8A\)/);
  assert.match(m.tips.join(" "), /8A, 7A, 9A, 8B/);
});

test("tempos too far apart: red, with a BPM range to pick from", () => {
  const m = assessMatch(deck("a", 128, "8A"), deck("b", 150, "8A"));
  assert.equal(m.level, "red");
  assert.match(m.tips[0], /between 121 and 136 BPM/);
});

test("unsure readings and missing ones are flagged, never a confident green", () => {
  assert.match(assessMatch(deck("a", 128, "8A"), deck("b", 128, "8A", false)).tips.join(" "), /\?, so check by ear/);
  const partly = assessMatch(deck("a", 128, null), deck("b", 128, "8A"));
  assert.equal(partly.level, "amber");
  assert.equal(partly.headline, "Only partly checked");
  assert.equal(assessMatch(deck("a", null, null), deck("b", 128, "8A")).level, "unknown");
});

test("waiting states before both tracks are read", () => {
  assert.equal(assessMatch({ id: "a", analysis: { status: "none" } }, deck("b", 128, "8A")).level, "waiting");
  assert.equal(assessMatch(deck("a", 128, "8A"), { id: "b", analysis: { status: "working" } }).headline, "Reading tempo and key…");
});

test("works the other way round when B is the playing deck", () => {
  const m = assessMatch(deck("b", 128, "8A"), deck("a", 124, "8A"));
  assert.match(m.tips.join(" "), /speed up A to 128 BPM/);
});
