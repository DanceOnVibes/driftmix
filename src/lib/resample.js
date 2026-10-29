/**
 * High-quality resampling (windowed sinc): reading a sound faster or slower
 * without adding harshness. Used for key shifts and by the time-stretch.
 */

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

