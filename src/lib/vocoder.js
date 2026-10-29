/**
 * Phase-vocoder time-stretch: changes tempo without changing pitch, working
 * on frequencies instead of slices. Used for everything below about 5 kHz
 * (bass, pads, vocals), where slice-based stretching (WSOLA) can leave a
 * faint grainy roughness on held notes: measured on a held chord, −52 dB of
 * unwanted sound here against −21 dB with WSOLA.
 *
 * How:
 *  - The sound is cut into overlapping 85 ms frames and each is turned into
 *    its frequencies (FFT). Frames are read a little further apart (faster)
 *    or closer together (slower) than they are written out.
 *  - Each frequency's phase is moved on by exactly how far that frequency
 *    turns in the written-out gap, so held notes stay smooth.
 *  - "Phase locking": bins around each peak move together with the peak, so
 *    a note keeps its shape (no "phasey" smear).
 *  - On a hit (a kick, a clap) the phases reset to the original, so attacks
 *    stay sharp.
 *  - Stereo: the decisions are made on the mix of both channels and the same
 *    turn is applied to left and right, so the stereo image doesn't wander.
 */

/** In-place complex FFT of size n (a power of two), with tables made once. */
function makeFft(n) {
  const levels = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return function fft(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let half = 1; half < n; half *= 2) {
      const step = n / (half * 2);
      for (let i = 0; i < n; i += half * 2) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step];
          const s = sign * sin[k * step];
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
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  };
}

/**
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {number} tempo  1.03 = 3% faster (shorter), 0.97 = slower
 * @param {{ frameSeconds?: number }} [o]
 * @returns {Float32Array[]}  each Math.ceil(length / tempo) long
 */
export function vocoderStretch(channels, sampleRate, tempo, { frameSeconds = 0.085 } = {}) {
  const C = channels.length;
  const length = channels[0].length;
  const outLength = Math.ceil(length / tempo);
  let N = 256;
  while (N < frameSeconds * sampleRate) N *= 2;
  const Hs = N / 4; // written-out hop
  const Ha = Hs * tempo; // read hop
  const bins = N / 2 + 1;
  const fft = makeFft(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const re = Array.from({ length: C }, () => new Float64Array(N));
  const im = Array.from({ length: C }, () => new Float64Array(N));
  // Stereo: both channels go through one FFT (left as the real part, right
  // as the imaginary part) and are separated after, which halves the work.
  const packed = C === 2;
  const zr = new Float64Array(N);
  const zi = new Float64Array(N);
  const mRe = new Float64Array(bins);
  const mIm = new Float64Array(bins);
  const mag = new Float64Array(bins);
  const prevMag = new Float64Array(bins);
  const prevRe = new Float64Array(bins);
  const prevIm = new Float64Array(bins);
  const theta = new Float64Array(bins); // turn applied to each bin this frame
  const prevTheta = new Float64Array(bins);
  const tc = new Float64Array(bins); // cos and sin of each bin's turn
  const ts = new Float64Array(bins);
  const peaks = new Int32Array(bins);
  const omega = new Float64Array(bins); // radians per sample for each bin
  for (let k = 0; k < bins; k++) omega[k] = (2 * Math.PI * k) / N;
  const TWO_PI = 2 * Math.PI;

  // Frames start a full frame before the track (reading silence), so the
  // very start is covered by overlapping frames like everything else; the
  // output buffer is shifted by N to match.
  const out = Array.from({ length: C }, () => new Float64Array(outLength + 2 * N));
  const wsum = new Float64Array(outLength + 2 * N);
  let first = true;
  let lastP0 = 0;

  for (let frame = -4; ; frame++) {
    const o = frame * Hs + N;
    if (o - N >= outLength) break;
    // Frames start on whole samples (reading between samples would dull the
    // top of the band); the real gap to the last frame is used for the phases.
    const p0 = Math.round(frame * Ha);
    const hop = p0 - lastP0;
    lastP0 = p0;
    if (packed) {
      const L = channels[0];
      const R = channels[1];
      for (let i = 0; i < N; i++) {
        const j = p0 + i;
        const inside = j >= 0 && j < length;
        zr[i] = inside ? L[j] * win[i] : 0;
        zi[i] = inside ? R[j] * win[i] : 0;
      }
      fft(zr, zi, false);
      const [lr, li] = [re[0], im[0]];
      const [rr, ri] = [re[1], im[1]];
      for (let k = 0; k < bins; k++) {
        const a = zr[k];
        const b = zi[k];
        const c = zr[(N - k) % N];
        const d = zi[(N - k) % N];
        lr[k] = (a + c) / 2;
        li[k] = (b - d) / 2;
        rr[k] = (b + d) / 2;
        ri[k] = (c - a) / 2;
      }
    } else {
      for (let c = 0; c < C; c++) {
        const x = channels[c];
        const r = re[c];
        const m = im[c];
        for (let i = 0; i < N; i++) {
          const j = p0 + i;
          r[i] = j >= 0 && j < length ? x[j] * win[i] : 0;
          m[i] = 0;
        }
        fft(r, m, false);
      }
    }
    // The mix of the channels decides the turns.
    let flux = 0;
    let total = 0;
    for (let k = 0; k < bins; k++) {
      let a = 0;
      let b = 0;
      for (let c = 0; c < C; c++) {
        a += re[c][k];
        b += im[c][k];
      }
      mRe[k] = a;
      mIm[k] = b;
      mag[k] = Math.sqrt(a * a + b * b);
      const d = mag[k] - prevMag[k];
      if (d > 0) flux += d;
      total += mag[k];
    }
    const hit = first || flux > 0.45 * total;
    if (hit) {
      theta.fill(0); // phase reset: write this frame as it is
      tc.fill(1);
      ts.fill(0);
    } else {
      // Peaks: bigger than two neighbours on each side.
      let np = 0;
      for (let k = 2; k < bins - 2; k++) {
        const v = mag[k];
        if (v > mag[k - 1] && v >= mag[k + 1] && v > mag[k - 2] && v >= mag[k + 2]) peaks[np++] = k;
      }
      if (!np) {
        for (let k = 0; k < bins; k++) {
          theta[k] = prevTheta[k] + omega[k] * (Hs - hop);
          tc[k] = Math.cos(theta[k]);
          ts[k] = Math.sin(theta[k]);
        }
      } else {
        // Each peak: how far it really turned since the last frame → its new turn.
        const peakTheta = new Float64Array(np);
        for (let q = 0; q < np; q++) {
          const k = peaks[q];
          const ph = Math.atan2(mIm[k], mRe[k]);
          const prev = Math.atan2(prevIm[k], prevRe[k]);
          let d = ph - prev - omega[k] * hop;
          d -= TWO_PI * Math.round(d / TWO_PI);
          const inst = omega[k] + d / hop; // radians per sample
          const synth = prev + prevTheta[k] + inst * Hs;
          peakTheta[q] = synth - ph;
        }
        // Every bin turns with its nearest peak (identity phase locking).
        let q = 0;
        let pc = Math.cos(peakTheta[0]);
        let ps = Math.sin(peakTheta[0]);
        for (let k = 0; k < bins; k++) {
          while (q + 1 < np && peaks[q + 1] - k < k - peaks[q]) {
            q++;
            pc = Math.cos(peakTheta[q]);
            ps = Math.sin(peakTheta[q]);
          }
          theta[k] = peakTheta[q];
          tc[k] = pc;
          ts[k] = ps;
        }
      }
    }
    for (let k = 0; k < bins; k++) {
      prevMag[k] = mag[k];
      prevRe[k] = mRe[k];
      prevIm[k] = mIm[k];
      let t = theta[k];
      t -= TWO_PI * Math.round(t / TWO_PI);
      prevTheta[k] = t;
    }
    first = false;
    // Turn every channel by the same amount and write it out.
    for (let c = 0; c < C; c++) {
      const r = re[c];
      const m = im[c];
      for (let k = 0; k < bins; k++) {
        const cs = tc[k];
        const sn = ts[k];
        const a = r[k];
        const b = m[k];
        r[k] = a * cs - b * sn;
        m[k] = a * sn + b * cs;
      }
      m[0] = 0; // DC and the top bin are real in a real signal
      m[N / 2] = 0;
    }
    if (packed) {
      // One inverse FFT gives left (real part) and right (imaginary part).
      const [lr, li] = [re[0], im[0]];
      const [rr, ri] = [re[1], im[1]];
      for (let k = 0; k <= N / 2; k++) {
        zr[k] = lr[k] - ri[k];
        zi[k] = li[k] + rr[k];
      }
      for (let k = 1; k < N / 2; k++) {
        // conj(L) + i·conj(R) for the mirrored half
        zr[N - k] = lr[k] + ri[k];
        zi[N - k] = -li[k] + rr[k];
      }
      fft(zr, zi, true);
      const dl = out[0];
      const dr = out[1];
      for (let i = 0; i < N; i++) {
        dl[o + i] += zr[i] * win[i];
        dr[o + i] += zi[i] * win[i];
      }
    } else {
      for (let c = 0; c < C; c++) {
        const r = re[c];
        const m = im[c];
        for (let k = 1; k < N / 2; k++) {
          r[N - k] = r[k];
          m[N - k] = -m[k];
        }
        fft(r, m, true);
        const dst = out[c];
        for (let i = 0; i < N; i++) dst[o + i] += r[i] * win[i];
      }
    }
    for (let i = 0; i < N; i++) wsum[o + i] += win[i] * win[i];
  }
  return out.map((dst) => {
    const y = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) y[i] = wsum[i + N] > 1e-6 ? dst[i + N] / wsum[i + N] : 0;
    return y;
  });
}
