/**
 * Studio-style bass, the way a mastering engineer does it, not a plain
 * "bass up" knob (which just makes things muddy and distorted):
 *
 *   1. cut the rumble you can't hear (below 25 Hz), which only eats headroom
 *   2. a warm low shelf around 100 Hz: the kick and the bassline come up
 *   3. a small dip around 250 Hz, so the bigger low end stays clean, not boomy
 *   4. a gentle limiter at the end: the extra bass never clips
 *
 * Auto: every track is mixed differently, so each one gets its own amount.
 * We compare the bass band (50–120 Hz) with the mids (500 Hz–4 kHz): a thin
 * track gets more, a track that already has a full low end gets little or
 * nothing.
 *
 * Plain maths on Float32Arrays, so it runs in a worker and in tests.
 */

export const BASS_MAX_DB = 6; // by hand
export const AUTO_MAX_DB = 5; // Auto never goes past this
/** The low end Auto aims for: the bass band this many dB above the mids. Natural "pink" balance measures about −4 dB here; full club low ends sit a few dB above that. */
export const BASS_TARGET = 4.5;
export const SHELF_HZ = 100;
export const MUD_HZ = 250;
export const RUMBLE_HZ = 25;

// ---- filters (RBJ "Audio EQ Cookbook" biquads) ---------------------------

function norm(b0, b1, b2, a0, a1, a2) {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function highpass(sampleRate, f0, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

export function lowpass(sampleRate, f0, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

/** Low shelf: everything below `f0` up (or down) by `gainDb`, a gentle slope (S = 0.7). */
export function lowShelf(sampleRate, f0, gainDb, slope = 0.7) {
  const A = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const r = 2 * Math.sqrt(A) * alpha;
  return norm(
    A * (A + 1 - (A - 1) * cos + r),
    2 * A * (A - 1 - (A + 1) * cos),
    A * (A + 1 - (A - 1) * cos - r),
    A + 1 + (A - 1) * cos + r,
    -2 * (A - 1 + (A + 1) * cos),
    A + 1 + (A - 1) * cos - r,
  );
}

/** A bell around `f0`, `gainDb` up or down. */
export function peaking(sampleRate, f0, q, gainDb) {
  const A = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return norm(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
}

/** Run a biquad over a channel (a new array unless `inPlace`). */
export function filter(input, c, inPlace = false) {
  const out = inPlace ? input : new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** How loud a filter makes a pure tone at `hz`, in dB (for tests and the preview label). */
export function responseDb(c, hz, sampleRate) {
  const w = (2 * Math.PI * hz) / sampleRate;
  const re = (b0, b1, b2) => b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w);
  const im = (b1, b2) => -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
  const num = Math.hypot(re(c.b0, c.b1, c.b2), im(c.b1, c.b2));
  const den = Math.hypot(re(1, c.a1, c.a2), im(c.a1, c.a2));
  return 20 * Math.log10(num / den);
}

/** The dip at 250 Hz that goes with a bass lift: a bit under half of it, at most 2.5 dB. */
export function mudCutDb(gainDb) {
  return -Math.min(2.5, Math.max(0, gainDb) * 0.4);
}

/** The whole EQ for a lift of `gainDb`, as the browser's own filters would set it (for the live preview too). */
export function bassChain(sampleRate, gainDb) {
  return [highpass(sampleRate, RUMBLE_HZ), lowShelf(sampleRate, SHELF_HZ, gainDb), peaking(sampleRate, MUD_HZ, 1, mudCutDb(gainDb))];
}

// ---- measuring ------------------------------------------------------------

function rmsDb(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, x.length) + 1e-20);
}

/** One channel to measure: the average of the channels. */
function mono(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

/**
 * How full the low end is: the bass band (50–120 Hz) against the mids
 * (500 Hz–4 kHz), in dB. Higher = bassier.
 */
export function bassBalance(channels, sampleRate) {
  const m = mono(channels);
  const band = (lo, hi) => {
    let x = filter(m, highpass(sampleRate, lo));
    x = filter(x, highpass(sampleRate, lo), true);
    filter(x, lowpass(sampleRate, hi), true);
    filter(x, lowpass(sampleRate, hi), true);
    return rmsDb(x);
  };
  return band(50, 120) - band(500, 4000);
}

/** Auto: the lift that brings this track's low end up to a full balance (0 when it's there already), in 0.5 dB steps. */
export function autoBassDb(balance) {
  if (!Number.isFinite(balance)) return 0;
  const want = BASS_TARGET - balance;
  return Math.max(0, Math.min(AUTO_MAX_DB, Math.round(want * 2) / 2));
}

/** Where the drop is: the start of the loudest `seconds` (for the before/after preview). */
export function loudestStart(channels, sampleRate, seconds = 20) {
  const m = mono(channels);
  const block = Math.round(sampleRate / 2);
  const energy = [];
  for (let i = 0; i + block <= m.length; i += block) {
    let s = 0;
    for (let j = i; j < i + block; j++) s += m[j] * m[j];
    energy.push(s);
  }
  const span = Math.max(1, Math.round((seconds * sampleRate) / block));
  if (energy.length <= span) return 0;
  let sum = energy.slice(0, span).reduce((a, b) => a + b, 0);
  let best = sum;
  let bestAt = 0;
  for (let k = span; k < energy.length; k++) {
    sum += energy[k] - energy[k - span];
    if (sum > best) {
      best = sum;
      bestAt = k - span + 1;
    }
  }
  return (bestAt * block) / sampleRate;
}

// ---- doing it ---------------------------------------------------------------

/**
 * A gentle look-ahead limiter: peaks above `ceilingDb` are turned down a few
 * milliseconds before they happen and let back up slowly, both channels
 * together, so nothing clips and nothing pumps.
 */
export function limit(channels, sampleRate, ceilingDb = -1, { lookaheadMs = 3, releaseMs = 80 } = {}) {
  const ceiling = 10 ** (ceilingDb / 20);
  const n = channels[0].length;
  const need = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of channels) p = Math.max(p, Math.abs(c[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
    if (p > ceiling) any = true;
  }
  if (!any) return { channels, reductionDb: 0 };
  const ahead = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
  // The lowest gain needed anywhere in the next few ms (a sliding minimum).
  const target = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[queue[tail - 1]] >= need[i]) tail--;
    queue[tail++] = i;
    while (queue[head] > i + ahead) head++;
    target[i] = need[queue[head]];
  }
  const release = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  let g = 1;
  let most = 1;
  for (let i = 0; i < n; i++) {
    g = target[i] < g ? target[i] : target[i] + (g - target[i]) * release;
    if (g < most) most = g;
    for (const c of channels) c[i] *= g;
  }
  return { channels, reductionDb: -20 * Math.log10(most) };
}

/**
 * The full bass treatment (in place): rumble cut, warm shelf, mud dip, and
 * the limiter so peaks stay under −1 dB.
 * @returns {{ channels: Float32Array[], reductionDb: number }}
 */
export function applyBass(channels, sampleRate, gainDb) {
  if (!(gainDb > 0)) return { channels, reductionDb: 0 };
  const chain = bassChain(sampleRate, gainDb);
  for (const c of channels) for (const f of chain) filter(c, f, true);
  return limit(channels, sampleRate, -1);
}
