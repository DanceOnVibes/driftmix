/**
 * Extended mix: a DJ version of a track, with a longer intro and outro made
 * of whole 8-bar phrases from the track itself, so there's room to mix in
 * and out on the beat.
 *
 *   intro:  the chosen 8 bars, repeated, then the track from its first downbeat
 *   outro:  the track up to the end of its music, then its chosen last 8 bars
 *           repeated, with the final bar fading out
 *
 * Which 8 bars: the phrase with the strongest beat (kick and bass) and the
 * least vocal, picked from the first third of the track for the intro and
 * the last third for the outro. Each repeat joins on a downbeat with an 8 ms
 * crossfade, so there's no click and the beat never shifts.
 *
 * Exact lengths: produced tracks are rarely exactly their rounded BPM (130.16
 * read as 130 makes an 8-bar phrase 18 ms too long, a flam at every repeat).
 * So each phrase's start and end are re-measured on the beats right there
 * (the same local beat grid the Mix button uses) before it's repeated.
 *
 * Plain maths on Float32Arrays, so it runs in a worker and in tests.
 */
import { highpass, lowpass, filter } from "./bass.js";
import { fitLocalGrid } from "../tempo.js";
import { downsample } from "../analyze.js";

export const PHRASE_BARS = 8;
export const EXTEND_CHOICES = { off: 0, "16": 16, "32": 32 };
const FADE_MS = 8;

function mono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

function band(x, sampleRate, lo, hi) {
  let y = filter(x, highpass(sampleRate, lo));
  y = filter(y, lowpass(sampleRate, hi), true);
  return y;
}

/** Energy per bar (sum of squares), bar b covering [start + b·bar, start + (b+1)·bar). */
function perBar(x, start, bar, count) {
  const out = new Float64Array(count);
  for (let b = 0; b < count; b++) {
    const a = Math.round(start + b * bar);
    const e = Math.min(x.length, Math.round(start + (b + 1) * bar));
    let s = 0;
    for (let i = a; i < e; i++) s += x[i] * x[i];
    out[b] = s / Math.max(1, e - a);
  }
  return out;
}

/**
 * Where things are in the track, in bars from the first downbeat.
 * @returns {{ bar: number, start: number, bars: number, endBar: number, intro: number, outro: number, scores: number[] }}
 *   bar: samples per bar; start: first downbeat (samples); bars: whole bars in the track;
 *   endBar: the bar after the last one with music; intro/outro: first bar of the chosen phrases
 */
export function extendPlan(channels, sampleRate, { bpm, firstBeat }) {
  const x = mono(channels);
  const bar = (sampleRate * 60 * 4) / bpm;
  // The first downbeat, moved back by whole bars as far as the track allows
  // (so music before it isn't lost when it's really bar 1).
  let start = firstBeat * sampleRate;
  while (start - bar >= 0) start -= bar;
  const bars = Math.floor((x.length - start) / bar);
  if (bars < PHRASE_BARS * 2) throw new Error("too short for an extended mix");

  const all = perBar(x, start, bar, bars);
  const low = perBar(band(x, sampleRate, 35, 130), start, bar, bars);
  const voice = perBar(band(x, sampleRate, 300, 3000), start, bar, bars);
  const sorted = [...all].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-12;

  // The end of the music: after the last bar at least 1/10 of a typical bar's energy (−10 dB).
  let endBar = bars;
  while (endBar > PHRASE_BARS * 2 && all[endBar - 1] < median * 0.1) endBar--;

  // Phrases start on 8-bar lines from the first downbeat.
  const phrases = [];
  for (let p = 0; p + PHRASE_BARS <= endBar; p += PHRASE_BARS) {
    let l = 0;
    let v = 0;
    let e = 0;
    for (let b = p; b < p + PHRASE_BARS; b++) {
      l += low[b];
      v += voice[b];
      e += all[b];
    }
    phrases.push({ at: p, low: l / PHRASE_BARS, voice: v / PHRASE_BARS, energy: e / PHRASE_BARS });
  }
  const lows = phrases.map((p) => p.low).sort((a, b) => a - b);
  const typicalLow = lows[Math.floor(lows.length / 2)] || 1e-12;
  // Strong beat (at least 60% of a typical phrase's low end), then as little voice as possible.
  const score = (p) => (p.low >= typicalLow * 0.6 ? 1 : 0) * 10 + Math.log10((p.low + 1e-12) / (p.voice + 1e-12));
  const pick = (list) => list.reduce((best, p) => (score(p) > score(best) ? p : best), list[0]);
  const third = Math.max(1, Math.ceil(phrases.length / 3));
  const intro = pick(phrases.slice(0, third)).at;
  // The outro phrase must end where the music ends (or earlier, on a phrase line).
  const outro = pick(phrases.slice(-third)).at;
  return { bar, start, bars, endBar, intro, outro, scores: phrases.map(score) };
}

/**
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {{ bpm: number, firstBeat: number }} grid  the track's tempo and first downbeat (seconds)
 * @param {{ introBars?: number, outroBars?: number }} lengths  whole phrases (multiples of 8)
 * @returns {{ channels: Float32Array[], plan: object, introSeconds: number, addedSeconds: number }}
 */
export function extendTrack(channels, sampleRate, grid, { introBars = 32, outroBars = 32 } = {}) {
  if (!(grid?.bpm > 0) || !Number.isFinite(grid?.firstBeat)) throw new Error("needs a steady beat");
  const plan = extendPlan(channels, sampleRate, grid);
  const { bar, start } = plan;
  const at = (b) => Math.round(start + b * bar); // sample position of bar b, from the whole-track tempo
  const m = mono(channels);
  const kick = band(m, sampleRate, 35, 150);
  /**
   * Where the kick nearest `pos` hits (within ±15 ms), so a phrase starts and
   * ends on the real hit, not just near it. null when there's no clear hit.
   */
  const snap = (pos) => {
    const reach = Math.round(0.015 * sampleRate);
    const hop = 4;
    const win = 32;
    const energy = (i) => {
      let e = 0;
      for (let j = i; j < i + win && j < kick.length; j++) e += kick[j] * kick[j];
      return e;
    };
    let best = 0;
    let at = pos;
    const rises = [];
    for (let i = Math.max(win, pos - reach); i <= Math.min(kick.length - win, pos + reach); i += hop) {
      const rise = energy(i) - energy(i - win);
      rises.push(Math.abs(rise));
      if (rise > best) {
        best = rise;
        at = i;
      }
    }
    rises.sort((a, b) => a - b);
    const typical = rises[Math.floor(rises.length / 2)] || 0;
    return best > typical * 4 && best > 1e-6 ? at : null;
  };
  /** Bars [b, b + count) measured on the local beats: [start, end] in samples. */
  const exact = (b, count) => {
    // About 30 s around the phrase: long enough for a sharp reading, short enough to follow a drifting tempo.
    const from = Math.max(0, at(b - 4));
    const to = Math.min(m.length, at(b + count + 4));
    const d = downsample(m.subarray(from, to), sampleRate);
    const g = to - from > sampleRate * 8 ? fitLocalGrid(d.samples, d.sampleRate, grid.bpm) : null;
    if (!g || !(g.confidence > 0.3) || Math.abs(g.bpm / grid.bpm - 1) > 0.01) return [at(b), at(b + count)];
    const beatLen = (60 / g.bpm) * sampleRate;
    const first = from + g.beat * sampleRate;
    const s = first + Math.round((at(b) - first) / beatLen) * beatLen; // the local beat nearest bar b
    return [Math.round(s), Math.round(s + count * 4 * beatLen)];
  };
  const introCopies = Math.round(introBars / PHRASE_BARS);
  const outroCopies = Math.round(outroBars / PHRASE_BARS);
  // Every edge on its real hit. The hit finder reads a few ms late (the bass
  // filter's delay), the same for every edge, so that's taken off again, plus
  // 2 ms: each join then falls just before the kick and the kick plays whole.
  // An edge with no clear hit (say, where the music stops) keeps its beat-grid place.
  const raw = [...exact(plan.intro, PHRASE_BARS), ...exact(plan.outro, PHRASE_BARS), exact(0, PHRASE_BARS)[0], exact(plan.endBar - PHRASE_BARS, PHRASE_BARS)[1]];
  const hits = raw.map(snap);
  const moved = hits.map((h, i) => (h === null ? null : h - raw[i])).filter((d) => d !== null).sort((a, b) => a - b);
  const bias = moved.length ? moved[Math.floor(moved.length / 2)] : 0;
  const margin = Math.round(0.002 * sampleRate);
  const [i0, i1, o0, o1, b0, b1] = hits.map((h, i) => Math.max(0, Math.min(m.length, (h === null ? raw[i] : h - bias) - margin)));
  const introPhrase = [i0, i1];
  const outroPhrase = [o0, o1];
  const body = { from: b0, to: b1 };
  const fade = Math.round((FADE_MS / 1000) * sampleRate);
  const n = channels[0].length;

  // The pieces, in order. Each join is cross-faded over the last 8 ms before
  // the downbeat (the new piece's lead-in fades in under the old one), so the
  // first kick of every piece arrives whole and exactly on the beat.
  const pieces = [];
  for (let k = 0; k < introCopies; k++) pieces.push(introPhrase);
  pieces.push([body.from, body.to]);
  for (let k = 0; k < outroCopies; k++) pieces.push(outroPhrase);
  const length = pieces.reduce((n, [a, b]) => n + (b - a), 0);

  return {
    channels: channels.map((x) => {
      const out = new Float32Array(length);
      let w = 0;
      pieces.forEach(([from, to], p) => {
        out.set(x.subarray(from, to), w);
        if (p > 0) {
          const f = Math.min(fade, from, w);
          for (let i = 0; i < f; i++) {
            const t = (i + 0.5) / f;
            // A straight (equal-gain) crossfade: both sides are about to hit the same kind of
            // downbeat, and an equal-power one would bump the level.
            out[w - f + i] = out[w - f + i] * (1 - t) + x[from - f + i] * t;
          }
        }
        w += to - from;
      });
      // A 2 ms fade-in at the very start (a phrase can begin mid-note), and
      // the last bar fades out, so the track ends cleanly on the beat.
      const lead = Math.min(length, Math.round(0.002 * sampleRate));
      for (let i = 0; i < lead; i++) out[i] *= (i + 0.5) / lead;
      const tail = Math.min(length, Math.round(bar));
      for (let i = 0; i < tail; i++) out[length - tail + i] *= Math.cos(((i + 0.5) / tail) * (Math.PI / 2)) ** 2;
      return out;
    }),
    plan,
    pieces, // [from, to] in the original, in order
    introSeconds: (introCopies * (introPhrase[1] - introPhrase[0])) / sampleRate,
    addedSeconds: (length - n) / sampleRate,
    firstBeat: 0, // the extended track starts on a downbeat
  };
}
