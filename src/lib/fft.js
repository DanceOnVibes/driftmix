/**
 * A small, fast Fourier transform (FFT). It turns a slice of sound into
 * "how much of each frequency is in it", which both the tempo and the key
 * detection need. Size must be a power of two (1024, 2048, …).
 */
export function createFft(size) {
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error("FFT size must be a power of two");
  const levels = Math.log2(size);
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
    reverse[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = Math.sin((2 * Math.PI * i) / size);
  }
  const window = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);

  /**
   * Magnitude spectrum of `size` samples of `signal` starting at `start`
   * (Hann-windowed). Writes size/2 + 1 values into `out`.
   */
  function magnitudes(signal, start, out) {
    for (let i = 0; i < size; i++) {
      const j = reverse[i];
      const s = start + i;
      re[j] = s < signal.length ? signal[s] * window[i] : 0;
      im[j] = 0;
    }
    for (let half = 1; half < size; half *= 2) {
      const step = size / (half * 2);
      for (let i = 0; i < size; i += half * 2) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step];
          const s = -sin[k * step];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let k = 0; k <= size / 2; k++) out[k] = Math.hypot(re[k], im[k]);
    return out;
  }

  return { size, magnitudes };
}

function hann(size) {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}
