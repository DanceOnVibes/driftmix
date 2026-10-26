/**
 * Musical keys and the Camelot wheel.
 *
 * A key is a root note (0 = C, 1 = C#, … 11 = B) plus major or minor.
 * The Camelot wheel numbers keys 1–12 so neighbours mix well:
 *   "A" = minor, "B" = major, e.g. D minor = 7A, F major = 7B.
 * Moving one step round the wheel (7A → 8A) is a fifth, which mixes cleanly.
 */
const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** Camelot code for a key, e.g. (2, "minor") → "7A". */
export function camelot(root, mode) {
  // Major keys: C = 8B, and each fifth up (+7 semitones) is one step round.
  // Minor keys share the number of their relative major (3 semitones up).
  const majorRoot = mode === "minor" ? (root + 3) % 12 : root;
  const number = ((majorRoot * 7 + 7) % 12) + 1;
  return `${number}${mode === "minor" ? "A" : "B"}`;
}

/** Human name, e.g. (2, "minor") → "D minor". */
export function keyName(root, mode) {
  return `${NOTES[((root % 12) + 12) % 12]} ${mode}`;
}

/** Read a Camelot code back, e.g. "7A" → { number: 7, letter: "A" }. */
export function parseCamelot(code) {
  const m = /^(1[0-2]|[1-9])([AB])$/i.exec(String(code).trim());
  return m ? { number: Number(m[1]), letter: m[2].toUpperCase() } : null;
}
