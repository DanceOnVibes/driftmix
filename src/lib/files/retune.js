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
import { resample } from "../resample.js";

export { resample };
import { shiftCamelot } from "../match.js";
import { keyName } from "../camelot.js";

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
 * What a track's reading becomes once a plan is applied to its audio, so a
 * retuned track doesn't have to be read again: the tempo scaled (and its
 * first beat moved with it), the key moved by the semitones.
 * @param {{ tempo: object|null, key: object|null }} found  as read from the original
 * @param {{ tempo?: number, semitones?: number }} plan  tempo: 1.01 = 1% faster
 * @returns {{ tempo: object|null, key: object|null }}
 */
export function retunedReading(found, { tempo = 1, semitones = 0 } = {}) {
  const t = found?.tempo ?? null;
  const k = found?.key ?? null;
  return {
    tempo: t && { ...t, bpm: t.bpm * tempo, firstBeat: t.firstBeat / tempo },
    key:
      k && semitones
        ? {
            ...k,
            root: typeof k.root === "number" ? (((k.root + semitones) % 12) + 12) % 12 : k.root,
            camelot: shiftCamelot(k.camelot, semitones),
            // Named the way the key reader names keys, so both agree.
            name: typeof k.root === "number" && k.mode ? keyName((((k.root + semitones) % 12) + 12) % 12, k.mode) : shiftKeyName(k.name, semitones),
            alt: k.alt ? { ...k.alt, camelot: shiftCamelot(k.alt.camelot, semitones), name: shiftKeyName(k.alt.name, semitones) } : k.alt ?? null,
          }
        : k,
  };
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
