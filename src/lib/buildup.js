/**
 * The build-up mix: a short snippet (one beat of a vocal, a synth stab, a
 * hook) repeats in time and gets faster and faster (a "roll"), a riser climbs,
 * everything stops for one beat, and the next track drops on its first beat.
 * Pure maths, tested without sound.
 *
 * The snippet comes from the track going out (its last words echo on) or from
 * the track coming in (a taste of its hook before it arrives).
 */

/**
 * When each repeat plays, in beats from the start of the build-up.
 * Over 8 bars: every 2 beats, then every beat, every half, every quarter,
 * then a fast eighth-beat roll, and the last beat is silent before the drop.
 * Shorter build-ups squeeze the same shape.
 * @param {number} bars  4 or 8 (others are scaled from the 8-bar shape)
 * @returns {{ at: number, length: number }[]}  at, length in beats
 */
export function rollPattern(bars = 8) {
  const total = bars * 4;
  // [share of the build-up, gap between repeats in beats]
  const shape =
    bars <= 4
      ? [
          [1 / 4, 1],
          [1 / 4, 1 / 2],
          [1 / 4, 1 / 4],
          [3 / 16, 1 / 8],
        ]
      : [
          [1 / 4, 2],
          [1 / 4, 1],
          [1 / 4, 1 / 2],
          [1 / 8, 1 / 4],
          [3 / 32, 1 / 8],
        ];
  const hits = [];
  let at = 0;
  for (const [share, gap] of shape) {
    const end = at + share * total;
    for (let t = at; t < end - 1e-9; t += gap) hits.push({ at: round(t), length: gap });
    at = end;
  }
  // The rest (the last beat) stays silent: the drop lands after a breath.
  return hits.filter((h) => h.at + h.length <= total - 1 + 1e-9);
}

/**
 * Pick the snippet: of the candidate beats, the one where the middle of the
 * sound (300 Hz – 3 kHz, where voices and leads live) is strongest and the
 * least of it is bass and kick.
 * @param {Float32Array} mono
 * @param {number} sampleRate
 * @param {{ start: number, length: number }[]} candidates  in seconds
 * @returns {number}  index of the best candidate (0 if none stands out)
 */
export function pickSnippet(mono, sampleRate, candidates) {
  let best = 0;
  let bestScore = -Infinity;
  candidates.forEach((c, i) => {
    const from = Math.max(0, Math.round(c.start * sampleRate));
    const to = Math.min(mono.length, Math.round((c.start + c.length) * sampleRate));
    if (to - from < 64) return;
    const mid = bandEnergy(mono, from, to, sampleRate, 300, 3000);
    const low = bandEnergy(mono, from, to, sampleRate, 30, 200);
    const score = mid / (1 + 0.5 * Math.sqrt(low / Math.max(mid, 1e-12)));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Mean energy between two frequencies (a simple band filter). */
function bandEnergy(x, from, to, sampleRate, lowHz, highHz) {
  const centre = Math.sqrt(lowHz * highHz);
  const q = centre / (highHz - lowHz);
  const w = (2 * Math.PI * centre) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let sum = 0;
  for (let i = from; i < to; i++) {
    const v = x[i];
    const y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    sum += y * y;
  }
  return sum / (to - from);
}

/**
 * Where to look for the snippet, in track seconds, one beat each.
 *  - outgoing: the 4 bars just before the build-up starts (its last words)
 *  - incoming: after its 16-bar intro, up to 48 bars in (where the hook or
 *    vocal usually is; intros are often drums only)
 * @param {{ bpm: number, firstBeat: number, duration: number }} t
 * @param {"outgoing"|"incoming"} from
 * @param {number} [startTrack]  outgoing: where the build-up starts
 * @returns {{ start: number, length: number }[]}
 */
export function snippetCandidates(t, from, startTrack = 0) {
  const beat = 60 / t.bpm;
  const list = [];
  if (from === "outgoing") {
    for (let k = 16; k >= 1; k--) {
      const s = startTrack - k * beat;
      if (s >= 0) list.push({ start: s, length: beat });
    }
  } else {
    const first = Math.max(0, t.firstBeat);
    for (let k = 64; k < 192; k++) {
      const s = first + k * beat;
      if (s + beat <= t.duration) list.push({ start: s, length: beat });
    }
    // A short track: anywhere after its first beat.
    if (!list.length) for (let s = first; s + beat <= t.duration; s += beat) list.push({ start: s, length: beat });
  }
  return list;
}

function round(x) {
  return Math.round(x * 1e6) / 1e6;
}
