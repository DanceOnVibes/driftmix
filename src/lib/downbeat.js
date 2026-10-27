/**
 * Downbeat: which beat is "1" of the bar.
 *
 * The tempo finder knows where the beats are, but not which one starts the
 * bar. Music changes on the 1: chords move, the bass note changes, new parts
 * come in. So for every beat we measure how much the notes changed from the
 * beat before, then add those up for beats 1, 2, 3 and 4 of each 4-beat
 * group. The group position with the most change is the downbeat.
 *
 * If the answer isn't clear (a track that sits on one chord), we keep the
 * first beat as the 1 and say we're not sure.
 */
import { createFft } from "./fft.js";
import { spectrumNotes } from "./key.js";

const FFT_SIZE = 4096;
const LOW_HZ = 60;
const HIGH_HZ = 2000;

/**
 * @param {Float32Array} signal  mono
 * @param {number} sampleRate
 * @param {number} bpm
 * @param {number} firstBeat  seconds
 * @returns {{ offset: 0|1|2|3, sure: boolean, strength: number[] }}
 *   offset: how many beats after firstBeat the first downbeat is
 */
export function findDownbeat(signal, sampleRate, bpm, firstBeat) {
  const fft = createFft(FFT_SIZE);
  const bins = FFT_SIZE / 2 + 1;
  const mag = new Float64Array(bins);
  const binHz = sampleRate / FFT_SIZE;
  const lo = Math.max(2, Math.floor(LOW_HZ / binHz));
  const hi = Math.min(bins - 2, Math.ceil(HIGH_HZ / binHz));
  const beat = 60 / bpm;
  const strength = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  let previous = null;
  const notes = new Float64Array(12);

  for (let k = 0; ; k++) {
    // Look at the middle of each beat (after the drum hit, before the next).
    const centre = firstBeat + (k + 0.5) * beat;
    const start = Math.round(centre * sampleRate - FFT_SIZE / 2);
    if (start + FFT_SIZE > signal.length) break;
    if (start < 0) continue;
    fft.magnitudes(signal, start, mag);
    let loudest = 0;
    for (let i = lo; i <= hi; i++) if (mag[i] > loudest) loudest = mag[i];
    if (loudest < FFT_SIZE * 0.5 * 1e-3) {
      previous = null;
      continue;
    }
    spectrumNotes(mag, binHz, lo, hi, loudest, notes);
    const current = Float64Array.from(notes);
    if (previous) {
      const change = 1 - cosine(previous, current);
      strength[k % 4] += change;
      counts[k % 4] += 1;
    }
    previous = current;
  }
  for (let i = 0; i < 4; i++) strength[i] = counts[i] ? strength[i] / counts[i] : 0;
  const ranked = [0, 1, 2, 3].sort((a, b) => strength[b] - strength[a]);
  const best = ranked[0];
  const second = strength[ranked[1]];
  // Clear winner: at least 25% more change than any other beat position.
  const sure = strength[best] > 0.02 && strength[best] >= second * 1.25;
  return { offset: sure ? best : 0, sure, strength };
}

function cosine(a, b) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < 12; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 1;
}
