/**
 * Does a track keep one tempo all the way through?
 *
 * AI-made tracks sometimes don't: one of Adalbert's measured 142 BPM in the
 * middle and 150 near the end. "Exact BPM" can only set a track's average
 * tempo, so it's worth knowing when the tempo wanders.
 *
 * How: read the tempo in 24-second sections (same reader as the whole track),
 * keep only the sections it's confident about (breakdowns without drums give
 * no clear beat), and compare the slowest with the fastest.
 */
import { detectTempo } from "./tempo.js";

const SECTION = 24; // seconds
const SURE = 0.5; // section confidence needed to count

/**
 * @param {Float32Array} samples  mono
 * @param {number} sampleRate
 * @param {number} bpm  the whole track's tempo (sections at half/double are folded to it)
 * @returns {{ from: number, bpm: number }[]}  confident sections only
 */
export function tempoSections(samples, sampleRate, bpm) {
  const out = [];
  const seconds = samples.length / sampleRate;
  for (let from = 0; from + SECTION <= seconds + 1e-9; from += SECTION) {
    const part = samples.subarray(Math.round(from * sampleRate), Math.round((from + SECTION) * sampleRate));
    const t = detectTempo(part, sampleRate);
    if (!t || t.confidence < SURE) continue;
    let b = t.bpm;
    for (const f of [2, 0.5]) if (Math.abs(t.bpm * f - bpm) < Math.abs(b - bpm)) b = t.bpm * f;
    out.push({ from, bpm: b });
  }
  return out;
}

/**
 * @returns {{ level: "steady"|"slight"|"wanders"|"unknown", min: number|null, max: number|null, percent: number }}
 *   steady: within 1% · slight: up to 2.5% (fine for mixing) · wanders: more
 */
export function steadiness(sections) {
  if (sections.length < 2) return { level: "unknown", min: null, max: null, percent: 0 };
  const values = sections.map((s) => s.bpm);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const percent = (max / min - 1) * 100;
  const level = percent <= 1 ? "steady" : percent <= 2.5 ? "slight" : "wanders";
  return { level, min, max, percent };
}
