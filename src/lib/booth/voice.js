/**
 * Vocal clean-up done on the recording itself (before the live effects):
 *  - a gentle noise gate, set from each recording's own room noise, and
 *  - a natural reverb tail, made from shaped noise (no sample files).
 */

/** Level in dB of every `blockMs` block of a recording. */
export function blockLevels(samples, sampleRate, blockMs = 5) {
  const size = Math.max(1, Math.round((blockMs / 1000) * sampleRate));
  const out = new Float32Array(Math.ceil(samples.length / size));
  for (let b = 0; b < out.length; b++) {
    let s = 0;
    const end = Math.min(samples.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) s += samples[i] * samples[i];
    out[b] = 10 * Math.log10(s / Math.max(1, end - b * size) + 1e-12);
  }
  return { levels: out, size };
}

/** The room's noise level: the quietest tenth of the recording, in dB. */
export function noiseFloorDb(samples, sampleRate) {
  const { levels } = blockLevels(samples, sampleRate, 20);
  if (!levels.length) return -90;
  const sorted = Float32Array.from(levels).sort();
  return sorted[Math.floor(sorted.length * 0.1)];
}

/**
 * Noise gate settings from the "Clean" knob (0–100) and the recording's own
 * noise: 0 = off; higher opens only above a level further over the noise, and
 * turns the gaps down further (never to dead silence, which sounds unnatural).
 */
export function gateSettings(clean, floorDb) {
  if (!(clean > 0)) return null;
  const k = Math.min(100, clean) / 100;
  return { thresholdDb: floorDb + 4 + 12 * k, rangeDb: -6 - 24 * k };
}

/**
 * Downward gate: between phrases (below the threshold) the level is turned
 * down by `rangeDb`; while singing it's left alone. Opens fast, closes slowly
 * after a short hold, so word endings and breaths aren't chopped.
 * @returns {Float32Array} a gated copy
 */
export function gate(samples, sampleRate, { thresholdDb, rangeDb, attackMs = 3, holdMs = 80, releaseMs = 150 }) {
  const out = new Float32Array(samples.length);
  const { levels, size } = blockLevels(samples, sampleRate, 5);
  const low = 10 ** (rangeDb / 20);
  const holdBlocks = Math.ceil(holdMs / 5);
  // Open / closed for each block, with hold and 3 dB of hysteresis.
  const target = new Float32Array(levels.length);
  let open = false;
  let held = 0;
  for (let b = 0; b < levels.length; b++) {
    if (levels[b] > thresholdDb) {
      open = true;
      held = holdBlocks;
    } else if (open && levels[b] < thresholdDb - 3) {
      if (held-- <= 0) open = false;
    }
    target[b] = open ? 1 : low;
  }
  // Look ahead one block so the gate is already open when a word starts.
  for (let b = 0; b < target.length - 1; b++) if (target[b + 1] === 1) target[b] = 1;
  const up = 1 - Math.exp(-1 / ((attackMs / 1000) * sampleRate));
  const down = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  let g = target[0] ?? 1;
  for (let i = 0; i < samples.length; i++) {
    const t = target[Math.floor(i / size)];
    g += (t - g) * (t > g ? up : down);
    out[i] = samples[i] * g;
  }
  return out;
}

/**
 * A reverb "room" made from noise: a few early reflections, then a tail that
 * fades over `seconds` and gets darker as it fades (like a real room).
 * Left and right differ slightly, for width.
 * @returns {Float32Array[]} [left, right]
 */
export function makeImpulse(sampleRate, { seconds = 1.8, predelay = 0.02, seed = 3 } = {}) {
  const n = Math.round((predelay + seconds) * sampleRate);
  const start = Math.round(predelay * sampleRate);
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  return [0, 1].map((side) => {
    const out = new Float32Array(n);
    // Early reflections: walls close by.
    for (const [ms, level] of [
      [7 + side * 3, 0.5],
      [13 - side * 2, 0.35],
      [21 + side * 4, 0.28],
      [34 - side * 3, 0.2],
    ]) {
      const at = start + Math.round((ms / 1000) * sampleRate);
      if (at < n) out[at] += level * (side ? -1 : 1);
    }
    // The tail: noise that fades (−60 dB at `seconds`) and darkens.
    let lp = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / sampleRate;
      const fade = Math.exp((-6.9 * t) / seconds);
      const bright = 0.6 * Math.exp((-3 * t) / seconds) + 0.08; // filter opens less as it fades
      lp += (rnd() - lp) * bright;
      out[i] += 0.25 * lp * fade;
    }
    return out;
  });
}

/**
 * Rumble cut: a 12 dB/octave high-pass (Butterworth) at `hz`. Removes desk
 * knocks, traffic and breath pops below the voice.
 */
export function highpass(samples, sampleRate, hz = 80) {
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/**
 * "Smooth": a compressor. Words louder than `threshold` (dB) are turned down
 * by `ratio` (4 = every 4 dB over becomes 1), with a soft knee so it's gentle,
 * then the whole vocal is turned up by `makeupDb`. Done on the recording
 * itself, so the vocal stays exactly on the beat (no processing delay).
 */
export function compress(samples, sampleRate, { threshold, ratio, knee = 8, attack = 0.008, release = 0.18, makeupDb = 0 }) {
  const out = new Float32Array(samples.length);
  const att = Math.exp(-1 / (attack * sampleRate));
  const rel = Math.exp(-1 / (release * sampleRate));
  const slope = 1 / ratio - 1;
  let g = 0; // gain change in dB (0 or below)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const level = 20 * Math.log10(Math.abs(x) + 1e-9);
    const over = level - threshold;
    let want = 0;
    if (2 * over >= knee) want = slope * over;
    else if (2 * over > -knee) want = (slope * (over + knee / 2) ** 2) / (2 * knee);
    g = want < g ? att * g + (1 - att) * want : rel * g + (1 - rel) * want;
    out[i] = x * Math.exp((g + makeupDb) * 0.11512925464970229); // 10^(dB/20)
  }
  return out;
}
