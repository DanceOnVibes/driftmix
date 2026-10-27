/**
 * Makes simple dance tracks for the tests: kick on every beat, clap on 2 and 4,
 * off-beat hats, a bass line and chord pads in a chosen key.
 * Only used by the tests, never by the app.
 */
const MINOR_PROGRESSION = [
  [0, 3, 7], // i
  [0, 3, 7], // i
  [8, 12, 15], // VI
  [10, 14, 17], // VII
];
const MAJOR_PROGRESSION = [
  [0, 4, 7], // I
  [7, 11, 14], // V
  [9, 12, 16], // vi
  [5, 9, 12], // IV
];

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/**
 * @param {{ bpm: number, root?: number, mode?: "major"|"minor", seconds?: number,
 *           sampleRate?: number, lead?: number, seed?: number, drumsOnly?: boolean }} o
 *   root: 0 = C … 11 = B. lead: seconds of silence before the first beat.
 */
export function synthTrack({ bpm, root = 2, mode = "minor", seconds = 40, sampleRate = 44100, lead = 0, seed = 7, drumsOnly = false, bright = false }) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const rnd = random(seed);
  const beat = 60 / bpm;
  const progression = mode === "minor" ? MINOR_PROGRESSION : MAJOR_PROGRESSION;

  const add = (startSec, lengthSec, fn) => {
    const s0 = Math.round(startSec * sampleRate);
    const len = Math.round(lengthSec * sampleRate);
    for (let i = 0; i < len && s0 + i < n; i++) if (s0 + i >= 0) out[s0 + i] += fn(i / sampleRate);
  };

  for (let b = 0; lead + b * beat < seconds; b++) {
    const t = lead + b * beat;
    // Kick: a falling sine, 120 Hz down to 50 Hz.
    let phase = 0;
    add(t, 0.3, (x) => {
      phase += (2 * Math.PI * (50 + 70 * Math.exp(-x * 30))) / sampleRate;
      return 0.8 * Math.sin(phase) * Math.exp(-x * 9);
    });
    // Off-beat hat: a short burst of bright noise.
    let last = 0;
    add(t + beat / 2, 0.04, (x) => {
      const r = rnd() * 2 - 1;
      const v = r - last;
      last = r;
      return 0.15 * v * Math.exp(-x * 90);
    });
    // Clap on beats 2 and 4.
    if (b % 2 === 1) add(t, 0.12, (x) => 0.25 * (rnd() * 2 - 1) * Math.exp(-x * 30));

    if (drumsOnly) continue;
    const chord = progression[Math.floor(b / 4) % progression.length];
    // Bass: the chord's root on the off-beat, octave 2.
    const bassHz = hz(36 + root + (chord[0] % 12));
    add(t + beat / 2, beat / 2, (x) => {
      let v = 0;
      for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * bassHz * h * x) / h;
      return 0.18 * v * Math.min(1, x * 200) * Math.exp(-x * 4);
    });
    // Pad: the chord held through the beat, octave 4, a few soft harmonics.
    add(t, beat, (x) => {
      let v = 0;
      for (const note of chord) {
        const f = hz(60 + root + note);
        for (let h = 1; h <= 3; h++) v += Math.sin(2 * Math.PI * f * h * (t + x)) / (h * h);
      }
      return 0.05 * v;
    });
    if (bright) {
      // A bright sawtooth lead (lots of overtones, like a supersaw) hammering
      // the key's root, plus the chord's fifth. Its 5th overtone lands on the
      // major third, which is what fools a key reader into "major".
      for (const [step, note] of [[0, 0], [0.5, 7], [0.25, 0], [0.75, 12]]) {
        const f = hz(60 + root + note);
        add(t + step * beat, beat / 4, (x) => {
          let v = 0;
          for (let h = 1; h <= 16; h++) v += Math.sin(2 * Math.PI * f * h * x) / h;
          return 0.09 * v * Math.min(1, x * 300) * Math.exp(-x * 6);
        });
      }
    }
  }
  return { samples: out, sampleRate };
}
