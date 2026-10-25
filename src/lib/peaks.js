/**
 * Waveform peaks: squeeze a whole track into a small list of bars to draw.
 *
 * A track has millions of samples; the screen has about a thousand pixels.
 * For each bar we keep the loudest positive and negative value in its slice,
 * averaged across the stereo channels, so the drawing shows the shape of the
 * music (kicks, breakdowns, drops) without drawing every sample.
 *
 * @param {Float32Array[]} channels  one array of samples per channel (-1..1)
 * @param {number} bars              how many bars to make
 * @returns {{ min: Float32Array, max: Float32Array }}
 */
export function computePeaks(channels, bars) {
  const min = new Float32Array(bars);
  const max = new Float32Array(bars);
  const length = channels[0]?.length ?? 0;
  if (!length || bars <= 0) return { min, max };

  const per = length / bars;
  for (let b = 0; b < bars; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(length, Math.max(start + 1, Math.floor((b + 1) * per)));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c][i];
      const v = sum / channels.length;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}
