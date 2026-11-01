// Extended mix tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { extendTrack, extendPlan, PHRASE_BARS } from "./extend.js";
import { lowpass, filter } from "./bass.js";

const SR = 44100;
const BPM = 128;
const BEAT = (60 / BPM) * SR; // samples

/**
 * A test track: a kick on every beat from `lead` seconds in, a "voice"
 * (1 kHz tone) in bars [voiceFrom, voiceTo), music for `bars` bars, then
 * `tailSeconds` of near-silence.
 */
function track({ bars = 64, lead = 0.25, voiceFrom = 0, voiceTo = 48, tailSeconds = 3 } = {}) {
  const n = Math.round(lead * SR + bars * 4 * BEAT + tailSeconds * SR);
  const x = new Float32Array(n);
  for (let b = 0; b < bars * 4; b++) {
    const at = Math.round(lead * SR + b * BEAT);
    for (let i = 0; i < 4000 && at + i < n; i++) x[at + i] += 0.7 * Math.exp(-i / 900) * Math.sin((2 * Math.PI * (50 + 80 * Math.exp(-i / 300)) * i) / SR);
  }
  const v0 = Math.round(lead * SR + voiceFrom * 4 * BEAT);
  const v1 = Math.round(lead * SR + voiceTo * 4 * BEAT);
  for (let i = v0; i < v1; i++) x[i] += 0.25 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  return { x, lead };
}

/** Where each kick starts in y (relative to where it should be), looking near each expected beat; the voice is filtered out first. */
function kicks(signal, firstAt, count) {
  const y = filter(filter(signal, lowpass(SR, 200)), lowpass(SR, 200), true);
  const out = [];
  for (let b = 0; b < count; b++) {
    const want = Math.round(firstAt + b * BEAT);
    let at = -1;
    for (let i = Math.max(0, want - 400); i < Math.min(y.length, want + 400); i++) {
      if (Math.abs(y[i]) > 0.15) {
        at = i;
        break;
      }
    }
    out.push(at - want);
  }
  return out;
}

const voiceLevel = (y, from, to) => {
  // 1 kHz energy by correlation
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    re += y[i] * Math.cos((2 * Math.PI * 1000 * i) / SR);
    im += y[i] * Math.sin((2 * Math.PI * 1000 * i) / SR);
  }
  return Math.hypot(re, im) / (to - from);
};

test("plan: finds the downbeat, the end of the music, and beat-only phrases", () => {
  const { x, lead } = track({ voiceFrom: 0, voiceTo: 48 });
  const p = extendPlan([x], SR, { bpm: BPM, firstBeat: lead });
  assert.ok(Math.abs(p.start - lead * SR) < 1, "first downbeat");
  assert.equal(p.endBar, 64, "music ends after bar 64 (the silent tail is not part of it)");
  // Voice covers bars 0–47: the intro must come from the first third, so the
  // least-voice phrase there still has voice; the outro picks bars 48–63 (no voice).
  assert.ok(p.outro >= 48, `outro phrase at bar ${p.outro}`);
  assert.equal(p.intro % PHRASE_BARS, 0);
});

test("intro prefers the phrase without vocals", () => {
  const { x, lead } = track({ bars: 96, voiceFrom: 0, voiceTo: 8 }); // voice only in the first 8 bars
  const p = extendPlan([x], SR, { bpm: BPM, firstBeat: lead });
  assert.ok(p.intro >= 8 && p.intro < 32, `intro phrase at bar ${p.intro}, not the vocal one`);
});

test("extended: exact length, 32 + 32 bars added, every kick still exactly on the beat", () => {
  const { x, lead } = track({ bars: 64, voiceFrom: 16, voiceTo: 40, tailSeconds: 3 });
  const r = extendTrack([x, x.slice()], SR, { bpm: BPM, firstBeat: lead }, { introBars: 32, outroBars: 32 });
  const bar = 4 * BEAT;
  const expected = Math.round(32 * bar) + Math.round(64 * bar) + Math.round(32 * bar);
  // Each phrase is measured on its own beats, so the length can differ from the theory by a hair (0.01%).
  assert.ok(Math.abs(r.channels[0].length / expected - 1) < 1e-4, `${r.channels[0].length} vs ${expected}`);
  assert.equal(r.channels.length, 2);
  assert.ok(Math.abs(r.introSeconds - (32 * bar) / SR) < 0.002);
  // 128 bars of kicks, all on the grid (within 0.2 ms), including across every join.
  const base = kicks(x, Math.round(lead * SR), 1)[0]; // how long a kick takes to cross the threshold
  // A kick on every beat, every gap one beat long (within 1 ms), across every join.
  // (The very first kick has a 2 ms fade-in, and the last bar fades out: both left out.)
  const y = filter(filter(r.channels[0], lowpass(SR, 200)), lowpass(SR, 200), true);
  const starts = [];
  for (let i = 1; i < y.length - Math.round(4 * BEAT); i++) {
    if (Math.abs(y[i]) > 0.15 && Math.abs(y[i - 1]) <= 0.15 && (!starts.length || i - starts.at(-1) > BEAT / 2)) starts.push(i);
  }
  assert.ok(Math.abs(starts.length - (128 * 4 - 4)) <= 1, `${starts.length} kicks`);
  const gaps = starts.slice(2).map((s, i) => s - starts[i + 1]);
  const worst = Math.max(...gaps.map((g) => Math.abs(g - BEAT)));
  assert.ok(worst <= SR / 1000, `every gap within ${((worst / SR) * 1000).toFixed(2)} ms of a beat`);
  // The intro is beat-only: no voice in its 32 bars.
  const introEnd = r.pieces.slice(0, 4).reduce((n, [a, b]) => n + (b - a), 0);
  const early = (lead * SR - r.pieces[4][0]) / SR;
  assert.ok(early >= 0 && early < 0.008, `the track itself starts just before its first downbeat (${(early * 1000).toFixed(1)} ms)`);
  assert.ok(voiceLevel(r.channels[0], 0, introEnd) < 0.01, "no vocal in the intro");
  // Then the track itself, from its first downbeat.
  for (let i = 0; i < 2000; i++) assert.ok(Math.abs(r.channels[0][introEnd + 200 + i] - x[r.pieces[4][0] + 200 + i]) < 1e-6);
  // Ends in silence.
  assert.ok(Math.abs(r.channels[0].at(-1)) < 1e-4);
});

test("no clicks at the joins", () => {
  const { x, lead } = track({ bars: 48, voiceFrom: 0, voiceTo: 48 }); // voice everywhere: joins mid-tone
  const r = extendTrack([x], SR, { bpm: BPM, firstBeat: lead }, { introBars: 16, outroBars: 16 });
  const y = r.channels[0];
  let worst = 0;
  for (let i = 1; i < y.length - Math.round(4 * BEAT); i++) worst = Math.max(worst, Math.abs(y[i] - y[i - 1]));
  let orig = 0;
  for (let i = 1; i < x.length; i++) orig = Math.max(orig, Math.abs(x[i] - x[i - 1]));
  assert.ok(worst <= orig * 1.05, `biggest sample jump ${worst.toFixed(3)} vs the original's ${orig.toFixed(3)}`);
});

test("refuses what it can't do well", () => {
  const { x, lead } = track({ bars: 10 });
  assert.throws(() => extendTrack([x], SR, { bpm: BPM, firstBeat: lead }), /too short/);
  assert.throws(() => extendTrack([x], SR, { bpm: null, firstBeat: 0 }), /steady beat/);
});
