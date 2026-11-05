// The coach line after each mix. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { coachLine } from "./coach.js";

test("a blend: length, phrase line, bass swap, tempo match, key", () => {
  const line = coachLine({ kind: "blend", bars: 16, phrase: true, to: "B", fromKey: "8A", toKey: "9A", toNativeBpm: 126, toHeardBpm: 128 });
  assert.equal(
    line,
    "16-bar blend, started on the phrase line (every 8 bars); the basses swapped half way so two kicks never fought. B played at 128 BPM instead of its own 126 to match. Keys 8A → 9A: neighbour on the wheel.",
  );
});

test("same tempo, and a key shift is explained", () => {
  const line = coachLine({ kind: "blend", bars: 8, phrase: false, to: "A", fromKey: "8B", toKey: "8A", toNativeBpm: 130, toHeardBpm: 130.02, semitones: -2 });
  assert.match(line, /^8-bar blend, started on the next bar;/);
  assert.match(line, /Same tempo, 130 BPM\./);
  assert.match(line, /Key shifted −2 semitones, so 8B → 8A: relative key \(A\/B swap\)\./);
});

test("echo-out and build-up say what they did; unknowns are left out", () => {
  assert.equal(
    coachLine({ kind: "bridge", why: "keys clash", to: "B", fromKey: null, toKey: "3B", toNativeBpm: null, toHeardBpm: null }),
    "Echo-out (keys clash): the old track echoed away and B dropped on its first beat, so nothing had to blend.",
  );
  assert.match(coachLine({ kind: "buildUp", to: "A", fromKey: "5A", toKey: "5A", toNativeBpm: 124, toHeardBpm: 124 }), /^Build-up: .* Same tempo, 124 BPM\. Keys 5A → 5A: same key\.$/);
});
