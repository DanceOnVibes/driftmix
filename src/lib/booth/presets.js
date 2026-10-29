/**
 * The Vocal Booth's knobs, presets, and what each knob does to the sound.
 * Every setting is visible; presets are just starting points.
 */

/** id, label, range, unit, and one line on what it does. */
export const KNOBS = [
  { id: "tune", label: "Tune", min: 0, max: 100, step: 1, unit: "%", help: "How much of the gap to the note is closed" },
  { id: "speed", label: "Speed", min: 10, max: 400, step: 10, unit: " ms", help: "Slow (200+) keeps your slides and vibrato; under 30 is the robotic effect" },
  { id: "clean", label: "Clean", min: 0, max: 100, step: 1, unit: "", help: "Turns the room noise down between phrases" },
  { id: "mud", label: "Mud cut", min: 0, max: 6, step: 0.5, unit: " dB", help: "Less boom and boxiness (around 300 Hz)" },
  { id: "presence", label: "Presence", min: 0, max: 6, step: 0.5, unit: " dB", help: "Words come forward (around 4 kHz)" },
  { id: "air", label: "Air", min: 0, max: 5, step: 0.5, unit: " dB", help: "Breath and shine on top" },
  { id: "squeeze", label: "Smooth", min: 0, max: 100, step: 1, unit: "", help: "Evens loud and quiet words (compression)" },
  { id: "reverb", label: "Reverb", min: 0, max: 100, step: 1, unit: "", help: "Room around the voice" },
  { id: "echo", label: "Echo", min: 0, max: 100, step: 1, unit: "", help: "Repeats in time with the beat" },
];

export const PRESETS = {
  natural: { label: "Natural", knobs: { tune: 0, speed: 250, clean: 30, mud: 2, presence: 2, air: 1, squeeze: 35, reverb: 18, echo: 0 } },
  radio: { label: "Radio", knobs: { tune: 30, speed: 180, clean: 45, mud: 3, presence: 4, air: 2, squeeze: 65, reverb: 8, echo: 0 } },
  big: { label: "Big chorus", knobs: { tune: 50, speed: 120, clean: 30, mud: 2.5, presence: 3, air: 3, squeeze: 55, reverb: 40, echo: 25 } },
  dry: { label: "Dry (as recorded)", knobs: { tune: 0, speed: 250, clean: 0, mud: 0, presence: 0, air: 0, squeeze: 0, reverb: 0, echo: 0 } },
};

/**
 * Turn knob positions into effect settings.
 * @param {Record<string, number>} k  knob values
 * @param {number|null} bpm  the beat's tempo, for the echo timing
 */
export function chainParams(k, bpm = null) {
  const s = Math.min(100, Math.max(0, k.squeeze ?? 0)) / 100;
  const threshold = -6 - 24 * s; // dB
  const ratio = 1 + 3 * s;
  // Compression lowers the loud parts; make some of that back up.
  const makeupDb = s > 0 ? -threshold * (1 - 1 / ratio) * 0.45 : 0;
  const r = Math.min(100, Math.max(0, k.reverb ?? 0)) / 100;
  const e = Math.min(100, Math.max(0, k.echo ?? 0)) / 100;
  const beat = bpm > 0 ? 60 / bpm : 0.5;
  return {
    highpassHz: 80, // always on: rumble, desk knocks, traffic
    mud: { hz: 300, q: 1, gainDb: -(k.mud ?? 0) },
    presence: { hz: 4000, q: 0.8, gainDb: k.presence ?? 0 },
    air: { hz: 10000, gainDb: k.air ?? 0 },
    comp: s > 0 ? { threshold, ratio, knee: 8, attack: 0.008, release: 0.18, makeupDb } : null,
    reverb: r ** 1.5 * 0.55, // wet level
    echo: { level: e * 0.32, time: Math.min(1.5, beat * 0.75), feedback: 0.25 + 0.2 * e }, // dotted eighth
  };
}

/**
 * Where to set the vocal so it sits just above the beat (in dB), from their
 * loudness (LUFS). A sensible start; the Vocal level slider moves from there.
 */
export function autoVocalDb(vocalLufs, beatLufs, above = 1) {
  if (!Number.isFinite(vocalLufs) || !Number.isFinite(beatLufs)) return 0;
  return Math.max(-12, Math.min(24, beatLufs + above - vocalLufs));
}
