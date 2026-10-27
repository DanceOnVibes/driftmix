/**
 * Key detection.
 *
 * How it works:
 *  1. Every half second we look at the notes sounding between 100 Hz and
 *     4 kHz: chords, leads and the upper part of the bass. Below 100 Hz the
 *     kick's thump smears across several notes and confuses the count, and
 *     above 4 kHz it's mostly hats.
 *     Each clear note adds to one of 12 boxes, C to B, regardless of octave.
 *     That gives the track's "note colour" (a chromagram).
 *  2. We compare that colour with the typical shape of all 24 keys
 *     (12 major, 12 minor), using the classic Krumhansl–Kessler key profiles,
 *     and pick the closest match.
 *
 * Honest limits: no key detector is perfect. The usual mistakes are the
 * relative key (D minor read as F major) or a fifth away. On the Camelot
 * wheel those are neighbours, so they still mix; the light in step 4 will
 * stay green for them.
 */
import { createFft } from "./fft.js";
import { camelot, keyName } from "./camelot.js";

const FFT_SIZE = 16384;
const LOW_HZ = 100;
const HIGH_HZ = 4000;

// Krumhansl & Kessler (1982): how strongly each note of the scale belongs to
// the key, starting from the root.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** The 12-box note colour of a mono signal (normalised so the biggest box is 1). */
export function chromagram(signal, sampleRate) {
  const fft = createFft(FFT_SIZE);
  const bins = FFT_SIZE / 2 + 1;
  const mag = new Float64Array(bins);
  const hop = Math.round(sampleRate / 2);
  const binHz = sampleRate / FFT_SIZE;
  const lo = Math.max(2, Math.floor(LOW_HZ / binHz));
  const hi = Math.min(bins - 2, Math.ceil(HIGH_HZ / binHz));
  const total = new Float64Array(12);
  const frame = new Float64Array(12);
  const quiet = FFT_SIZE * 0.5 * 1e-3; // a note quieter than about −60 dB is ignored

  for (let start = 0; start + FFT_SIZE <= signal.length || start === 0; start += hop) {
    fft.magnitudes(signal, start, mag);
    let loudest = 0;
    for (let k = lo; k <= hi; k++) if (mag[k] > loudest) loudest = mag[k];
    if (loudest < quiet) {
      if (start + FFT_SIZE > signal.length) break;
      continue;
    }
    spectrumNotes(mag, binHz, lo, hi, loudest, frame);
    let top = 0;
    for (let i = 0; i < 12; i++) if (frame[i] > top) top = frame[i];
    if (top > 0) for (let i = 0; i < 12; i++) total[i] += frame[i] / top;
    if (start + FFT_SIZE > signal.length) break;
  }
  let top = 0;
  for (let i = 0; i < 12; i++) if (total[i] > top) top = total[i];
  if (top > 0) for (let i = 0; i < 12; i++) total[i] /= top;
  return total;
}

/**
 * The notes in one spectrum, folded into 12 boxes (C … B). Only clear peaks
 * count (louder than 3% of the loudest), each weighted by how in tune it is.
 * Also used by the downbeat finder.
 */
export function spectrumNotes(mag, binHz, lo, hi, loudest, frame) {
  frame.fill(0);
  const floor = loudest * 0.03;
  for (let k = lo; k <= hi; k++) {
    const m = mag[k];
    if (m < floor || m <= mag[k - 1] || m < mag[k + 1]) continue;
    // Find the exact frequency between bins (parabolic peak).
    const a = mag[k - 1];
    const c = mag[k + 1];
    const shift = (0.5 * (a - c)) / (a - 2 * m + c || 1);
    const hz = (k + shift) * binHz;
    const midi = 69 + 12 * Math.log2(hz / 440);
    const note = Math.round(midi);
    const off = Math.abs(midi - note); // 0 = in tune, 0.5 = between notes
    const fit = Math.cos((Math.PI / 2) * (off / 0.5)) ** 2;
    frame[((note % 12) + 12) % 12] += m * fit;
  }
  return frame;
}

function correlation(x, y) {
  let mx = 0;
  let my = 0;
  for (let i = 0; i < 12; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= 12;
  my /= 12;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < 12; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Every key ranked by how well it matches a chromagram, best first. */
export function rankKeys(chroma) {
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [
      ["major", MAJOR],
      ["minor", MINOR],
    ]) {
      const rotated = new Array(12);
      for (let i = 0; i < 12; i++) rotated[(i + root) % 12] = profile[i];
      out.push({ root, mode, score: correlation(chroma, rotated) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Detect the key of a mono signal.
 * @returns {{ root: number, mode: "major"|"minor", camelot: string, name: string, confidence: number } | null}
 */
export function detectKey(signal, sampleRate) {
  const chroma = chromagram(signal, sampleRate);
  if (!chroma.some((v) => v > 0)) return null;
  const [best] = rankKeys(chroma);
  // Confidence from how closely the best key matches: real music scores about
  // 0.85+, drums only about 0.5, pure noise about 0.35.
  const confidence = Math.max(0, Math.min(1, (best.score - 0.45) / 0.4));
  return {
    root: best.root,
    mode: best.mode,
    camelot: camelot(best.root, best.mode),
    name: keyName(best.root, best.mode),
    confidence,
  };
}
