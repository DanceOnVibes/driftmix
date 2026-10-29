/**
 * Pitch correction you control.
 *
 *  1. Find the note you're singing, every 10 ms (the YIN method: compare the
 *     sound with itself shifted by one period; the shift that matches best is
 *     the period of the note).
 *  2. Work out how far each moment is from the note it's aiming at, and
 *     smooth that: slowly ("Speed" in ms), so slides and vibrato stay yours
 *     and only the overall drift is fixed; or fast, for the robotic effect.
 *     "Tune" sets how much of the gap is closed (0–100%).
 *  3. Move the pitch with PSOLA: the voice is cut into one-period slices at
 *     each vocal-cord pulse and the slices are placed a little closer together
 *     (higher) or further apart (lower). The slices themselves aren't
 *     stretched, so the voice keeps its own colour (no chipmunk), and every
 *     slice stays where it was in time, so the take stays on the beat.
 */
import { resample } from "../files/retune.js";

const RATE = 16000; // detection works at 16 kHz: plenty for a voice, 3× faster

/** Scale notes (0 = C … 11 = B) for a key. */
export function scaleFor(root, mode) {
  const steps = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return steps.map((s) => (root + s) % 12);
}

const toMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

/**
 * Find the sung pitch.
 * @param {Float32Array} samples  mono
 * @param {number} sampleRate
 * @returns {{ hop: number, start: number, f0: Float32Array }}
 *   frame i is at `start + i * hop` seconds; f0 in Hz, 0 = no clear note
 *   (silence, breath, "s" and "t" sounds)
 */
export function detectPitch(samples, sampleRate, { hopMs = 10, minHz = 70, maxHz = 1000, threshold = 0.15 } = {}) {
  const x = Math.abs(sampleRate - RATE) < 1 ? samples : resample([samples], sampleRate / RATE)[0];
  const W = 512;
  const maxLag = Math.ceil(RATE / minHz);
  const minLag = Math.floor(RATE / maxHz);
  const hop = Math.round((hopMs / 1000) * RATE);
  const count = Math.max(0, Math.floor((x.length - W - maxLag) / hop) + 1);
  const f0 = new Float32Array(count);
  const power = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) power[i + 1] = power[i] + x[i] * x[i];
  const d = new Float64Array(maxLag + 2);
  const quiet = W * 10 ** (-50 / 10); // below −50 dB: nothing to tune
  for (let f = 0; f < count; f++) {
    const s = f * hop;
    const e1 = power[s + W] - power[s];
    if (e1 < quiet) continue;
    let sum = 0;
    let found = -1;
    for (let tau = 1; tau <= maxLag; tau++) {
      let acf = 0;
      for (let j = 0; j < W; j++) acf += x[s + j] * x[s + j + tau];
      const raw = e1 + (power[s + tau + W] - power[s + tau]) - 2 * acf;
      sum += raw;
      // Cumulative mean normalised difference: 0 = a perfect repeat.
      d[tau] = sum > 0 ? (raw * tau) / sum : 1;
      if (found < 0) {
        if (tau >= minLag && d[tau] < threshold) found = tau;
      } else if (d[tau] < d[found]) found = tau; // follow the dip to its bottom
      else break;
    }
    if (found < 0) continue;
    const tau = found;
    if (tau === maxLag) d[maxLag + 1] = d[maxLag];
    // Refine between lags (parabola through the three points).
    const a = d[tau - 1];
    const b = d[tau];
    const c = d[tau + 1];
    const den = a - 2 * b + c;
    const shift = den > 0 ? (0.5 * (a - c)) / den : 0;
    f0[f] = RATE / (tau + Math.max(-0.5, Math.min(0.5, shift)));
  }
  cleanTrack(f0);
  return { hop: hop / RATE, start: W / 2 / RATE, f0 };
}

/** Remove one-frame octave slips and blips shorter than 40 ms. */
function cleanTrack(f0) {
  const n = f0.length;
  for (let i = 1; i < n - 1; i++) {
    const p = f0[i - 1];
    const q = f0[i + 1];
    const v = f0[i];
    if (!v || !p || !q) continue;
    const near = (p + q) / 2;
    for (const k of [2, 0.5]) if (Math.abs(v * k - near) < Math.abs(v - near) && Math.abs(v * k / near - 1) < 0.06) f0[i] = v * k;
  }
  let runStart = -1;
  for (let i = 0; i <= n; i++) {
    const voiced = i < n && f0[i] > 0;
    if (voiced && runStart < 0) runStart = i;
    if (!voiced && runStart >= 0) {
      if (i - runStart < 4) for (let k = runStart; k < i; k++) f0[k] = 0;
      runStart = -1;
    }
  }
}

/** Runs of frames with a clear note: [first, last] frame indices. */
export function voicedRuns(f0) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= f0.length; i++) {
    const v = i < f0.length && f0[i] > 0;
    if (v && start < 0) start = i;
    if (!v && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}

/**
 * The note each moment is aiming at. Nearest note; but when you're well in
 * between two notes (more than 35 cents from the nearest), the one in the key
 * wins. So a note you really sing outside the key is respected, and only the
 * unclear in-between moments lean on the key.
 */
export function targetNote(midi, scale) {
  const near = Math.round(midi);
  if (!scale || Math.abs(midi - near) <= 0.35) return near;
  const other = midi > near ? near + 1 : near - 1;
  const inKey = (m) => scale.includes(((m % 12) + 12) % 12);
  if (inKey(near)) return near;
  if (inKey(other)) return other;
  return near;
}

/**
 * How much to move the pitch at every frame, in semitones.
 * @param {{ hop: number, f0: Float32Array }} track
 * @param {{ amount: number, speedMs: number, scale?: number[]|null }} o
 *   amount 0–100 (% of the gap closed), speedMs: how slowly the fix follows
 */
export function correctionCurve(track, { amount, speedMs, scale = null }) {
  const n = track.f0.length;
  const out = new Float32Array(n);
  if (!(amount > 0)) return out;
  const k = Math.min(100, amount) / 100;
  // Zero-lag smoothing: one pass forwards, one backwards.
  const tau = Math.max(1, speedMs) / 1000 / 2;
  const alpha = 1 - Math.exp(-track.hop / tau);
  const ramp = Math.max(1, Math.round(0.02 / track.hop)); // ease in/out over 20 ms at each phrase edge
  for (const [a, b] of voicedRuns(track.f0)) {
    const len = b - a + 1;
    const midi = new Float32Array(len);
    for (let i = 0; i < len; i++) midi[i] = toMidi(track.f0[a + i]);
    // Decide the note from the pitch smoothed over ~120 ms (so vibrato doesn't
    // flip it), and hold it until you've clearly moved to another note.
    const smooth = midi.slice();
    const beta = 1 - Math.exp(-track.hop / 0.06);
    let u = smooth[0];
    for (let i = 0; i < len; i++) smooth[i] = u += beta * (smooth[i] - u);
    u = smooth[len - 1];
    for (let i = len - 1; i >= 0; i--) smooth[i] = u += beta * (smooth[i] - u);
    const gap = new Float32Array(len);
    let note = targetNote(smooth[0], scale);
    for (let i = 0; i < len; i++) {
      if (Math.abs(smooth[i] - note) > 0.65) note = targetNote(smooth[i], scale);
      gap[i] = note - midi[i];
    }
    let y = gap[0];
    for (let i = 0; i < len; i++) gap[i] = y += alpha * (gap[i] - y);
    y = gap[len - 1];
    for (let i = len - 1; i >= 0; i--) gap[i] = y += alpha * (gap[i] - y);
    for (let i = 0; i < len; i++) {
      const edge = Math.min(1, (i + 1) / ramp, (len - i) / ramp);
      out[a + i] = gap[i] * k * edge;
    }
  }
  return out;
}

/**
 * How in tune a take is: how far the centre of each note is from the note
 * (cents; vibrato isn't counted as out of tune), and how much of the singing
 * is within 25 cents (sounds in tune in a mix).
 */
export function pitchStats(track, scale = null) {
  let sum = 0;
  let close = 0;
  let count = 0;
  const beta = 1 - Math.exp(-track.hop / 0.06);
  for (const [a, b] of voicedRuns(track.f0)) {
    const len = b - a + 1;
    const m = new Float32Array(len);
    for (let i = 0; i < len; i++) m[i] = toMidi(track.f0[a + i]);
    let u = m[0];
    for (let i = 0; i < len; i++) m[i] = u += beta * (m[i] - u);
    u = m[len - 1];
    for (let i = len - 1; i >= 0; i--) m[i] = u += beta * (m[i] - u);
    for (let i = 0; i < len; i++) {
      const cents = Math.abs(m[i] - targetNote(m[i], scale)) * 100;
      sum += cents;
      if (cents <= 25) close++;
      count++;
    }
  }
  return count ? { meanCents: sum / count, within25: close / count, seconds: count * track.hop } : null;
}

/** Read between samples smoothly (cubic). */
function cubicAt(x, pos) {
  const i = Math.floor(pos);
  const t = pos - i;
  const a = x[i - 1] ?? 0;
  const b = x[i] ?? 0;
  const c = x[i + 1] ?? 0;
  const d = x[i + 2] ?? 0;
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

/**
 * Move the pitch of a voice by `shift` semitones (one value per pitch frame),
 * keeping its timing and colour (PSOLA). Only the sung parts are touched;
 * everything else is the original, with 10 ms fades between.
 *
 * Slices are one period apart (from the pitch found) and are placed with
 * sub-sample accuracy: rounding them to whole samples adds a faint roughness
 * (measured: −30 dB between the harmonics, against −52 dB done exactly).
 */
export function shiftPitch(samples, sampleRate, track, shift) {
  const out = samples.slice();
  const at = (i) => Math.round((track.start + i * track.hop) * sampleRate);
  const fade = Math.round(0.01 * sampleRate);

  for (const [a, b] of voicedRuns(track.f0)) {
    let moved = false;
    for (let i = a; i <= b; i++) if (Math.abs(shift[i]) > 0.002) moved = true;
    if (!moved) continue;
    const from = at(a);
    const to = Math.min(samples.length - 1, at(b));
    if (to - from < fade * 3) continue;
    const frameOf = (t) => Math.max(a, Math.min(b, Math.round((t / sampleRate - track.start) / track.hop)));
    const periodAt = (t) => sampleRate / track.f0[frameOf(t)];

    // Analysis marks: one per period, through the phrase and a period either side.
    const marks = [];
    for (let m = Math.max(1, from - periodAt(from)); m < Math.min(samples.length - 2, to + periodAt(to)); m += periodAt(m)) marks.push(m);
    if (marks.length < 4) continue;

    const first = Math.floor(marks[0]);
    const last = Math.ceil(marks[marks.length - 1]);
    const y = new Float64Array(last - first + 1);
    const wsum = new Float64Array(last - first + 1);
    let k = 0;
    for (let ts = marks[0]; ts <= marks[marks.length - 1]; ) {
      while (k + 1 < marks.length && Math.abs(marks[k + 1] - ts) <= Math.abs(marks[k] - ts)) k++;
      const mk = marks[k];
      const P = periodAt(mk);
      for (let n = Math.ceil(ts - P); n <= Math.floor(ts + P); n++) {
        const idx = n - first;
        if (idx < 0 || idx >= y.length) continue;
        const off = n - ts;
        const w = 0.5 + 0.5 * Math.cos((Math.PI * off) / P);
        y[idx] += cubicAt(samples, mk + off) * w;
        wsum[idx] += w;
      }
      ts += P / 2 ** (shift[frameOf(ts)] / 12);
    }
    // Blend in: original at the phrase edges, tuned inside.
    for (let i = from; i <= to; i++) {
      const ws = wsum[i - first];
      if (!(ws > 0.3)) continue;
      const tuned = y[i - first] / ws;
      const edge = Math.min(1, (i - from) / fade, (to - i) / fade);
      out[i] = samples[i] * (1 - edge) + tuned * edge;
    }
  }
  return out;
}
