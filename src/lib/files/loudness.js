/**
 * Loudness in LUFS (ITU-R BS.1770-4 / EBU R128): how loud a track sounds,
 * not just how high its peaks go. Streaming services play music at about
 * −14 LUFS; club masters are often around −9.
 *
 * K-weighting (a gentle treble lift + a bass cut, like the ear), mean square
 * in 400 ms blocks every 100 ms, then the two gates: ignore blocks below
 * −70 LUFS, then blocks more than 10 LU under the average.
 */

function biquad(b0, b1, b2, a1, a2) {
  return { b0, b1, b2, a1, a2 };
}

/** K-weighting filters for any sample rate (same maths as libebur128). */
export function kWeighting(sampleRate) {
  // Stage 1: high shelf, about +4 dB above 2 kHz.
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // Stage 2: high pass at about 38 Hz.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass = biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  return [shelf, highpass];
}

function filter(samples, f) {
  const out = new Float64Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/**
 * Integrated loudness of a track.
 * @param {Float32Array[]} channels  left and right (or one channel)
 * @returns {number}  LUFS, or -Infinity for silence
 */
export function integratedLufs(channels, sampleRate) {
  const [shelf, hp] = kWeighting(sampleRate);
  const weighted = channels.map((c) => filter(filter(c, shelf), hp));
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const n = weighted[0].length;
  if (n < block) return -Infinity;

  // Running sums of squares make every block cheap.
  const prefix = weighted.map((w) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + w[i] * w[i];
    return p;
  });
  const powers = [];
  for (let start = 0; start + block <= n; start += step) {
    let z = 0;
    for (const p of prefix) z += (p[start + block] - p[start]) / block;
    powers.push(z);
  }
  const lufs = (z) => -0.691 + 10 * Math.log10(z);
  const aboveAbsolute = powers.filter((z) => z > 0 && lufs(z) > -70);
  if (!aboveAbsolute.length) return -Infinity;
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const relativeGate = lufs(mean(aboveAbsolute)) - 10;
  const gated = aboveAbsolute.filter((z) => lufs(z) > relativeGate);
  return lufs(mean(gated));
}

/**
 * The gain that brings a track to `targetLufs` without its peaks going over
 * `ceilingDb`. If the peaks would go over, it stops short (no limiter, so
 * nothing gets squashed) and says so.
 * @returns {{ gainDb: number, measured: number, result: number, heldBack: boolean }}
 */
export function loudnessGain(measured, peak, targetLufs, ceilingDb = -1) {
  if (!Number.isFinite(measured)) return { gainDb: 0, measured, result: measured, heldBack: false };
  const wanted = targetLufs - measured;
  const allowed = ceilingDb - peak;
  const gainDb = Math.min(wanted, allowed);
  return { gainDb, measured, result: measured + gainDb, heldBack: gainDb < wanted - 0.05 };
}
