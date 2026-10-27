/**
 * Small audio tools for preparing files: peaks, gain, silence trimming,
 * mono, and turning float audio into whole numbers with dither.
 */

/** Loudest sample across channels, in dB (0 dB = full scale). */
export function peakDb(channels) {
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export function applyGainDb(channels, db) {
  if (!db) return channels;
  const g = 10 ** (db / 20);
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= g;
  return channels;
}

/** Average the channels into one. */
export function toMono(channels) {
  if (channels.length === 1) return channels;
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return [out];
}

/**
 * Cut silence at the start and end (quieter than `thresholdDb`), keeping a
 * few milliseconds so the first hit isn't clipped.
 * @returns {{ channels: Float32Array[], start: number, end: number }}  start/end in samples of the original
 */
export function trimSilence(channels, sampleRate, thresholdDb = -60, keepMs = 10) {
  const limit = 10 ** (thresholdDb / 20);
  const n = channels[0].length;
  const loud = (i) => channels.some((c) => Math.abs(c[i]) > limit);
  let start = 0;
  while (start < n && !loud(start)) start++;
  let end = n;
  while (end > start && !loud(end - 1)) end--;
  if (start >= end) return { channels, start: 0, end: n };
  const keep = Math.round((keepMs / 1000) * sampleRate);
  start = Math.max(0, start - keep);
  end = Math.min(n, end + keep);
  return { channels: channels.map((c) => c.slice(start, end)), start, end };
}

/**
 * Float (−1..1) to signed integers of `bits`, with TPDF dither (two random
 * numbers added) so quiet fades don't turn gritty at 16-bit.
 * Deterministic random numbers, so the same input gives the same file.
 */
export function toInt(samples, bits, seed = 1) {
  const max = 2 ** (bits - 1) - 1;
  const min = -(2 ** (bits - 1));
  const out = bits <= 16 ? new Int16Array(samples.length) : new Int32Array(samples.length);
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const dither = bits <= 16;
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i] * max;
    if (dither) v += rnd() - rnd();
    v = Math.round(v);
    out[i] = v > max ? max : v < min ? min : v;
  }
  return out;
}
