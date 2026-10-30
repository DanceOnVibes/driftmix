/**
 * The Sample maker: cut a loop or one-shot out of a track exactly on the
 * beat. Pure maths and sample work, tested without sound.
 *
 * A sample is a whole number of beats long (or half a beat), measured in
 * samples from the track's own tempo, so it loops seamlessly anywhere that
 * loops on the beat: the pads here, a Build-up, or Beat Loop on a CDJ/XDJ.
 */
import { safeName } from "./files/naming.js";

/** Lengths offered, in beats. */
export const SAMPLE_BEATS = [0.5, 1, 2, 4, 8, 16];

/**
 * The nearest grid line to a moment in the track.
 * @param {number} seconds  track seconds
 * @param {{ bpm: number, firstBeat: number }} t
 * @param {number} step  in beats (1 = beat, 0.5 = half beat, 4 = bar)
 */
export function snapTo(seconds, { bpm, firstBeat }, step = 1) {
  const grid = (step * 60) / bpm;
  const k = Math.round((seconds - firstBeat) / grid);
  let at = firstBeat + k * grid;
  while (at < 0) at += grid;
  return at;
}

/**
 * Where the sample sits in the audio, in whole samples. The length comes
 * from the tempo, not from rounding the start and end separately, so every
 * 4-beat sample at 128 BPM is exactly the same number of samples long.
 * @returns {{ from: number, frames: number }}
 */
export function sampleRange({ start, beats, bpm, sampleRate, length }) {
  const frames = Math.round((beats * 60 * sampleRate) / bpm);
  const from = Math.max(0, Math.min(Math.round(start * sampleRate), length - frames));
  return { from, frames: Math.min(frames, length) };
}

/**
 * Copy the sample out, with tiny fades (half a millisecond) at both ends so
 * it never clicks, even when it loops.
 * @param {Float32Array[]} channels
 * @param {number} from
 * @param {number} frames
 * @param {{ sampleRate: number, cutLowHz?: number }} o  cutLowHz: take out bass and kick below it
 */
export function cutSample(channels, from, frames, { sampleRate, cutLowHz = 0 }) {
  const fade = Math.max(1, Math.round(0.0005 * sampleRate));
  return channels.map((ch) => {
    let out;
    if (cutLowHz > 0) {
      // Run the filter from a little earlier so it has settled by the start.
      const pre = Math.min(from, Math.round(0.25 * sampleRate));
      const part = highpass(ch.subarray(from - pre, from + frames), sampleRate, cutLowHz);
      out = part.slice(pre, pre + frames);
    } else out = ch.slice(from, from + frames);
    for (let i = 0; i < fade && i < out.length; i++) {
      const g = i / fade;
      out[i] *= g;
      out[out.length - 1 - i] *= g;
    }
    return out;
  });
}

/** 24 dB per octave high-pass (two Butterworth stages). */
export function highpass(x, sampleRate, hz) {
  let y = Float32Array.from(x);
  for (let pass = 0; pass < 2; pass++) {
    const w = (2 * Math.PI * hz) / sampleRate;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    const b0 = (1 + cos) / 2 / a0;
    const b1 = -(1 + cos) / a0;
    const b2 = b0;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    const out = new Float32Array(y.length);
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      const r = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = v;
      y2 = y1;
      y1 = r;
      out[i] = r;
    }
    y = out;
  }
  return y;
}

/**
 * When the next beat (or half beat, or bar) of a playing track comes round,
 * in context time, so a pad lands in time.
 * @param {{ now: number, position: number, speed: number, bpm: number, firstBeat: number }} d
 *   now: context time; position: track seconds at `now`; speed: track s per real s
 * @param {number} step  beats
 * @param {number} [minLead]  real seconds needed to get it ready
 */
export function nextBeatTime({ now, position, speed, bpm, firstBeat }, step = 1, minLead = 0.03) {
  const grid = (step * 60) / bpm;
  const earliest = position + minLead * speed;
  const k = Math.ceil((earliest - firstBeat) / grid - 1e-9);
  const at = firstBeat + k * grid;
  return now + (at - position) / speed;
}

/** "Vortex - 4 beats - 134 BPM 9B.wav" */
export function sampleName({ title, beats, bpm, camelot, ext = "wav" }) {
  const len = beats === 0.5 ? "half beat" : `${beats} beat${beats === 1 ? "" : "s"}`;
  const tempo = bpm ? `${Math.round(bpm * 10) / 10} BPM` : "";
  const info = [tempo, camelot].filter(Boolean).join(" ");
  return `${safeName([title || "Sample", len, info].filter(Boolean).join(" - "))}.${ext}`;
}
