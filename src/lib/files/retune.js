/**
 * Exact BPM and key shift for a finished track.
 *
 *  - Exact BPM: time-stretch (WSOLA, see ../stretch.js) so the track plays at
 *    exactly the tempo asked for, without changing its pitch.
 *  - Key shift: move the whole track up or down by whole semitones. Done as a
 *    stretch to a slightly different length, then a high-quality resample that
 *    plays it back faster or slower, which brings the length back and moves
 *    the pitch. Tempo and pitch both end up exactly where they should be.
 */
import { timeStretch } from "../stretch.js";
import { shiftCamelot } from "../match.js";

const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const ALIASES = { Db: 1, "D#": 3, Gb: 6, "G#": 8, "A#": 10 };

/** "F# minor" moved by +1 semitone → "G minor". */
export function shiftKeyName(name, semitones) {
  const m = /^([A-G](?:#|b)?)\s+(major|minor)$/.exec(String(name || "").trim());
  if (!m) return name || null;
  const root = NOTES.indexOf(m[1]) >= 0 ? NOTES.indexOf(m[1]) : ALIASES[m[1]];
  if (root === undefined) return name;
  return `${NOTES[(((root + semitones) % 12) + 12) % 12]} ${m[2]}`;
}

/**
 * What a track will be after the change.
 * @param {{ bpm?: number|null, camelot?: string|null, keyName?: string|null }} found  as read
 * @param {{ targetBpm?: number|null, semitones?: number }} want
 * @returns {{ tempo: number, percent: number, bpm: number|null, camelot: string|null, keyName: string|null, semitones: number, changed: boolean }}
 */
export function retunePlan(found, { targetBpm = null, semitones = 0 } = {}) {
  const bpm = found.bpm > 0 ? found.bpm : null;
  let tempo = 1;
  if (targetBpm > 0 && bpm) tempo = targetBpm / bpm;
  if (Math.abs(tempo - 1) < 2e-4) tempo = 1; // 0.02%: nothing to do
  return {
    tempo,
    percent: (tempo - 1) * 100,
    bpm: targetBpm > 0 && bpm ? targetBpm : bpm,
    camelot: found.camelot ? (semitones ? shiftCamelot(found.camelot, semitones) : found.camelot) : null,
    keyName: found.keyName ? shiftKeyName(found.keyName, semitones) : null,
    semitones,
    changed: tempo !== 1 || semitones !== 0,
  };
}

/**
 * Read a track faster (ratio > 1: higher and shorter) or slower, with a
 * windowed-sinc filter so nothing harsh is added. Ratio 2^(1/12) = one
 * semitone up.
 * @param {Float32Array[]} channels
 * @param {number} ratio
 * @returns {Float32Array[]}
 */
export function resample(channels, ratio) {
  if (Math.abs(ratio - 1) < 1e-9) return channels.map((c) => c.slice());
  // Reading faster pushes high notes above what the file can hold, so the
  // filter cuts a little lower then (anti-aliasing).
  const cutoff = Math.min(1, 1 / ratio) * 0.95;
  const crossings = 16;
  const half = Math.ceil(crossings / cutoff);
  const taps = 2 * half;
  const PHASES = 2048;
  const table = new Float32Array((PHASES + 1) * taps);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const d = j - half + 1 - frac; // distance of this input sample from the read point
      const x = cutoff * d;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = Math.abs(d) >= half ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half); // Blackman
      const v = cutoff * sinc * w;
      table[p * taps + j] = v;
      sum += v;
    }
    for (let j = 0; j < taps; j++) table[p * taps + j] /= sum; // no change in level
  }
  const length = Math.floor(channels[0].length / ratio);
  return channels.map((input) => {
    const out = new Float32Array(length);
    const last = input.length - 1;
    for (let n = 0; n < length; n++) {
      const t = n * ratio;
      const base = Math.floor(t);
      const row = Math.round((t - base) * PHASES) * taps;
      const first = base - half + 1;
      let acc = 0;
      if (first >= 0 && first + taps - 1 <= last) {
        for (let j = 0; j < taps; j++) acc += input[first + j] * table[row + j];
      } else {
        for (let j = 0; j < taps; j++) {
          const k = first + j;
          if (k >= 0 && k <= last) acc += input[k] * table[row + j];
        }
      }
      out[n] = acc;
    }
    return out;
  });
}

/**
 * Apply a plan: exact tempo and key shift together.
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {{ tempo: number, semitones: number }} plan
 */
export function retune(channels, sampleRate, { tempo = 1, semitones = 0 }) {
  if (tempo === 1 && !semitones) return channels;
  const pitch = 2 ** (semitones / 12);
  // Stretch to tempo ÷ pitch first; reading it pitch× faster then lands on
  // the wanted tempo, with the pitch moved.
  const stretched = timeStretch(channels, sampleRate, tempo / pitch);
  return semitones ? resample(stretched, pitch) : stretched;
}
