/**
 * Tempo (BPM) detection.
 *
 * How it works, in three steps:
 *  1. Onsets: about 86 times a second we measure how much "new sound" arrived
 *     (kicks, claps and hats make sharp jumps). That gives a pulse line.
 *     We keep a second line for the low end only (below 120 Hz), which is
 *     mostly the kick: that's what tells us where the beat really lands.
 *  2. Rough tempo: we look for the repeat distance in that pulse line,
 *     checking 1, 2, 4 and 8 beats ahead, between 70 and 180 BPM. Dance music
 *     sits around 120–130, so tempos near there get a small head start; this
 *     stops 64 being picked when the track is really 128.
 *  3. Fine tempo: we lay an exact beat grid over the whole track, nudging the
 *     tempo by 0.01 BPM at a time, and keep the grid that lands on the most
 *     hits. The best grid also tells us where the first beat is.
 */
import { createFft } from "./fft.js";

const FFT_SIZE = 1024;
const HOP = 256;
export const MIN_BPM = 70;
export const MAX_BPM = 180;
const PREFERRED_BPM = 128;
/** The kick's low end: the pulse line for "where is the beat". */
const KICK_HZ = 120;
/**
 * The pulse line reacts slightly before the hit is centred in the measuring
 * window; this moves the beat grid back onto the hit (measured on test tracks).
 */
const ONSET_SHIFT = 0.032;

/** Step 1: the pulse line. Returns one value per hop and how many per second. */
export function onsetEnvelope(signal, sampleRate) {
  const fft = createFft(FFT_SIZE);
  const bins = FFT_SIZE / 2 + 1;
  const frames = signal.length >= FFT_SIZE ? Math.floor((signal.length - FFT_SIZE) / HOP) + 1 : 0;
  const raw = new Float64Array(frames);
  const rawLow = new Float64Array(frames);
  const lowBins = Math.max(2, Math.round((KICK_HZ * FFT_SIZE) / sampleRate));
  const mag = new Float64Array(bins);
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    fft.magnitudes(signal, f * HOP, mag);
    let flux = 0;
    let fluxLow = 0;
    for (let k = 1; k < bins; k++) {
      cur[k] = Math.log1p(100 * mag[k]);
      const rise = cur[k] - prev[k];
      if (rise > 0) {
        flux += rise;
        if (k <= lowBins) fluxLow += rise;
      }
    }
    raw[f] = f === 0 ? 0 : flux;
    rawLow[f] = f === 0 ? 0 : fluxLow;
    [prev, cur] = [cur, prev];
  }

  const fps = sampleRate / HOP;
  return { env: cleanUp(raw, fps), kick: cleanUp(rawLow, fps), fps };
}

/**
 * Take away the slow swell of the track (build-ups, breakdowns) so only the
 * sharp hits remain, smooth very slightly, and scale to 0..1.
 */
function cleanUp(raw, fps) {
  const frames = raw.length;
  const half = Math.max(1, Math.round(fps / 2));
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + raw[i];
  const hits = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(frames, i + half + 1);
    hits[i] = Math.max(0, raw[i] - (prefix[hi] - prefix[lo]) / (hi - lo));
  }
  const env = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    env[i] = 0.25 * (hits[i - 1] ?? hits[i]) + 0.5 * hits[i] + 0.25 * (hits[i + 1] ?? hits[i]);
    if (env[i] > peak) peak = env[i];
  }
  if (peak > 0) for (let i = 0; i < frames; i++) env[i] /= peak;
  return env;
}


/** How strongly the pulse line repeats after `lag` frames (lag may be fractional). */
function makeAutocorrelation(env, maxLag) {
  const n = env.length;
  // Measure around the average level, so only the repeating hits count.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n || 1;
  const centred = new Float64Array(n);
  let power = 0;
  for (let i = 0; i < n; i++) {
    centred[i] = env[i] - mean;
    power += centred[i] ** 2;
  }
  power /= n || 1;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1 && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += centred[i] * centred[i + lag];
    ac[lag] = power > 0 ? Math.max(0, s / (n - lag) / power) : 0;
  }
  return (lag) => {
    const i = Math.floor(lag);
    if (i < 1 || i + 1 >= ac.length) return 0;
    const t = lag - i;
    return ac[i] * (1 - t) + ac[i + 1] * t;
  };
}

/** Head start for tempos near 128 BPM (1 at 128, about 0.45 an octave away). */
function preference(bpm) {
  const octaves = Math.log2(bpm / PREFERRED_BPM);
  return Math.exp(-0.5 * (octaves / 0.8) ** 2);
}

/** Step 3: how well a beat grid with this period (in frames) lands on hits. */
function gridScore(env, period) {
  let best = -Infinity;
  let bestPhase = 0;
  const steps = Math.ceil(period * 2);
  for (let p = 0; p < steps; p++) {
    const phase = p / 2;
    let s = 0;
    let n = 0;
    for (let t = phase; t < env.length - 1; t += period) {
      const i = Math.floor(t);
      const f = t - i;
      s += env[i] * (1 - f) + env[i + 1] * f;
      n++;
    }
    if (n && s / n > best) {
      best = s / n;
      bestPhase = phase;
    }
  }
  return { score: best, phase: bestPhase };
}

/**
 * Detect the tempo of a mono signal.
 * @returns {{ bpm: number, confidence: number, firstBeat: number } | null}
 *   bpm to one decimal; confidence 0..1; firstBeat in seconds.
 *   null when there's no steady beat to find (silence, too short).
 */
export function detectTempo(signal, sampleRate) {
  const { env, kick, fps } = onsetEnvelope(signal, sampleRate);
  const framesPerBeatAt = (bpm) => (fps * 60) / bpm;
  const maxLag = Math.ceil(framesPerBeatAt(MIN_BPM) * 8) + 2;
  // Needs at least ~8 beats of music.
  if (env.length < framesPerBeatAt(MIN_BPM) * 8) return null;

  // The kick leads; the rest of the drums help where the kick drops out.
  const pulse = new Float32Array(env.length);
  for (let i = 0; i < pulse.length; i++) pulse[i] = kick[i] + 0.5 * env[i];

  const ac = makeAutocorrelation(pulse, maxLag);
  const acKick = makeAutocorrelation(kick, maxLag);
  let rough = 0;
  let roughScore = -Infinity;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM + 1e-9; bpm += 0.1) {
    const L = framesPerBeatAt(bpm);
    // Hits 1, 2, 4 and 8 beats apart all count. The kick counts most: it
    // should repeat every beat (rules out 2/3 mix-ups), and not every half
    // beat (if it does, the real tempo is double).
    const s = (ac(L) + ac(2 * L) + ac(4 * L) + ac(8 * L) + 4 * acKick(L) - 2 * acKick(L / 2)) * preference(bpm);
    if (s > roughScore) {
      roughScore = s;
      rough = bpm;
    }
  }
  if (!(roughScore > 0)) return null;

  let bpm = rough;
  let bestScore = -Infinity;
  for (let candidate = rough - 1; candidate <= rough + 1 + 1e-9; candidate += 0.01) {
    const g = gridScore(pulse, framesPerBeatAt(candidate));
    if (g.score > bestScore) {
      bestScore = g.score;
      bpm = candidate;
    }
  }

  // Produced tracks are nearly always on a whole number.
  const whole = Math.round(bpm);
  bpm = Math.abs(bpm - whole) <= 0.06 ? whole : Math.round(bpm * 10) / 10;

  // Confidence: how strongly the music really repeats at this tempo, 1, 2 and
  // 4 beats apart (about 0.8–0.95 for a steady dance beat, near 0 for noise).
  const L = framesPerBeatAt(bpm);
  const confidence = Math.max(0, Math.min(1, (ac(L) + ac(2 * L) + ac(4 * L)) / 3));

  // Where the beat lands: the grid that best fits the kick, moved back to the
  // start of the track.
  const period = framesPerBeatAt(bpm);
  const phase = gridScore(kick.some((v) => v > 0) ? kick : pulse, period).phase;
  const seconds = (phase * HOP) / sampleRate + ONSET_SHIFT;
  const beat = 60 / bpm;
  const firstBeat = ((seconds % beat) + beat) % beat;

  return { bpm, confidence, firstBeat };
}
