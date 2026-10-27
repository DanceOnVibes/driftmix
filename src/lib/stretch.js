/**
 * Time-stretch: change a track's tempo without changing its pitch ("key lock").
 *
 * Method: WSOLA (waveform similarity overlap-add). The track is cut into short
 * overlapping slices (about 46 ms). To play faster we take slices from a
 * little further ahead each time; to play slower, from a little behind. Each
 * slice is nudged (up to ±10 ms) to the spot where its waveform lines up best
 * with the slice before it, then they are cross-faded together. That's what
 * stops the result sounding choppy or phasey.
 *
 * Good for the small changes DJs make (a few percent). It's what the
 * transition button uses to bring the next track to the playing tempo.
 */

/**
 * @param {Float32Array[]} channels  the track, one array per channel
 * @param {number} sampleRate
 * @param {number} tempo  1.03 = 3% faster (shorter), 0.97 = 3% slower (longer)
 * @returns {Float32Array[]} the stretched channels
 */
export function timeStretch(channels, sampleRate, tempo) {
  if (!(tempo > 0)) throw new Error("tempo must be positive");
  if (Math.abs(tempo - 1) < 1e-5) return channels.map((c) => c.slice());

  const length = channels[0].length;
  const hop = 2 ** Math.round(Math.log2(0.023 * sampleRate)); // 1024 at 44.1/48 kHz
  const size = hop * 2;
  const reach = Math.round(0.01 * sampleRate);
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);

  // The search for the best spot runs on a quarter-rate mono copy (fast),
  // then is refined at full rate.
  const mono = new Float32Array(length);
  for (const c of channels) for (let i = 0; i < length; i++) mono[i] += c[i] / channels.length;
  const D = 4;
  const small = new Float32Array(Math.ceil(length / D));
  for (let i = 0; i < small.length; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += mono[i * D + k] || 0;
    small[i] = s / D;
  }

  const outLength = Math.ceil(length / tempo);
  const out = channels.map(() => new Float32Array(outLength + size));
  const last = Math.max(0, length - size);
  let previous = 0;

  for (let k = 0; k * hop < outLength; k++) {
    let chosen = 0;
    if (k > 0) {
      const nominal = Math.round(k * hop * tempo);
      chosen = bestSpot(mono, small, D, previous + hop, nominal, reach, hop, last);
    }
    const at = k * hop;
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < size; i++) {
        const s = chosen + i;
        if (s >= length) break;
        dst[at + i] += window[i] * src[s];
      }
    }
    previous = chosen;
  }
  return out.map((c) => c.subarray(0, outLength).slice());
}

/**
 * Where near `nominal` does the audio best continue the previous slice?
 * Compares candidates against `natural` (the seamless continuation point).
 */
function bestSpot(mono, small, D, natural, nominal, reach, hop, last) {
  const lo = Math.max(0, nominal - reach);
  const hi = Math.min(last, nominal + reach);
  if (hi <= lo) return Math.min(Math.max(0, nominal), last);
  if (natural + hop > mono.length) return Math.min(Math.max(lo, nominal), hi);

  // Coarse: quarter rate, compare the overlap region (one hop long).
  const n = Math.floor(hop / D);
  const t0 = Math.floor(natural / D);
  let best = lo;
  let bestScore = -Infinity;
  for (let c = Math.ceil(lo / D); c * D <= hi; c++) {
    let dot = 0;
    let energy = 1e-9;
    for (let i = 0; i < n; i++) {
      const v = small[c + i] || 0;
      dot += v * (small[t0 + i] || 0);
      energy += v * v;
    }
    const score = dot / Math.sqrt(energy);
    if (score > bestScore) {
      bestScore = score;
      best = c * D;
    }
  }
  // Fine: full rate, ±D samples around the coarse pick.
  let fine = best;
  bestScore = -Infinity;
  for (let c = Math.max(lo, best - D); c <= Math.min(hi, best + D); c++) {
    let dot = 0;
    let energy = 1e-9;
    for (let i = 0; i < hop; i += 2) {
      const v = mono[c + i] || 0;
      dot += v * (mono[natural + i] || 0);
      energy += v * v;
    }
    const score = dot / Math.sqrt(energy);
    if (score > bestScore) {
      bestScore = score;
      fine = c;
    }
  }
  return fine;
}
