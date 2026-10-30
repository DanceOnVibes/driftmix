// Build-up mix tests: the roll's shape and the snippet picker. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { rollPattern, pickSnippet, snippetCandidates } from "./buildup.js";

test("roll over 8 bars: gets faster in steps, never crosses the last (silent) beat", () => {
  const hits = rollPattern(8);
  const gaps = [...new Set(hits.map((h) => h.length))];
  assert.deepEqual(gaps, [2, 1, 0.5, 0.25, 0.125]);
  assert.equal(hits[0].at, 0);
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i].at >= hits[i - 1].at + hits[i - 1].length - 1e-9, "repeats never overlap");
    assert.ok(hits[i].length <= hits[i - 1].length, "never slows down");
  }
  const last = hits[hits.length - 1];
  assert.ok(last.at + last.length <= 31 + 1e-9, `last repeat ends at beat ${last.at + last.length}`);
  assert.ok(last.at + last.length >= 30.5, "the roll runs right up to the breath");
  // Every repeat starts on a sixteenth (in time with the beat).
  for (const h of hits) assert.ok(Math.abs(h.at * 8 - Math.round(h.at * 8)) < 1e-6, `${h.at}`);
});

test("roll over 4 bars: the same shape, squeezed", () => {
  const hits = rollPattern(4);
  assert.deepEqual([...new Set(hits.map((h) => h.length))], [1, 0.5, 0.25, 0.125]);
  const last = hits[hits.length - 1];
  assert.ok(last.at + last.length <= 15 + 1e-9);
});

test("snippet: picks the beat with a voice-like tone over beats of kick and hiss", () => {
  const sr = 48000;
  const beat = 0.5;
  const n = sr * beat * 6;
  const x = new Float32Array(n);
  let seed = 3;
  for (let i = 0; i < n; i++) {
    const t = (i % (sr * beat)) / sr;
    x[i] = 0.8 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 12); // a kick every beat
    seed = (seed * 16807) % 2147483647;
    x[i] += 0.05 * ((seed / 2147483647) * 2 - 1); // hiss
  }
  // Beat 4 has a "voice": 440 Hz with harmonics.
  for (let i = 4 * sr * beat; i < 5 * sr * beat; i++) for (let h = 1; h <= 5; h++) x[i] += (0.15 / h) * Math.sin((2 * Math.PI * 440 * h * i) / sr);
  const candidates = Array.from({ length: 6 }, (_, k) => ({ start: k * beat, length: beat }));
  assert.equal(pickSnippet(x, sr, candidates), 4);
});

test("snippet places: last 4 bars before the build-up (outgoing), after a 16-bar intro (incoming)", () => {
  const t = { bpm: 120, firstBeat: 0.25, duration: 240 };
  const out = snippetCandidates(t, "outgoing", 100);
  assert.equal(out.length, 16);
  assert.ok(Math.abs(out[out.length - 1].start - 99.5) < 1e-9 && out[0].start === 92);
  const inc = snippetCandidates(t, "incoming");
  assert.ok(Math.abs(inc[0].start - (0.25 + 64 * 0.5)) < 1e-9, "starts after 16 bars");
  assert.equal(inc.length, 128);
  const short = snippetCandidates({ bpm: 120, firstBeat: 0, duration: 20 }, "incoming");
  assert.ok(short.length > 0, "a short track still offers something");
});
