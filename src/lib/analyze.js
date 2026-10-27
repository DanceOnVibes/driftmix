/**
 * Reads a track's tempo and key. Runs inside a background worker so the
 * decks keep playing smoothly while it thinks.
 */
import { detectTempo } from "./tempo.js";
import { detectKey } from "./key.js";
import { findDownbeat } from "./downbeat.js";

/** Analysis works at about 22 kHz: plenty for beats and notes, and 2× faster. */
const TARGET_RATE = 22050;

/** Lower the sample rate by averaging groups of samples (e.g. 44.1 kHz → 22.05 kHz). */
export function downsample(samples, sampleRate) {
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  if (factor === 1) return { samples, sampleRate };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0, j = 0; i < out.length; i++, j += factor) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[j + k];
    out[i] = s / factor;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}

/**
 * @param {Float32Array} mono  the track mixed down to one channel
 * @param {number} sampleRate
 * @returns {{ tempo: object|null, key: object|null, seconds: number }}
 *   tempo: { bpm, firstBeat (the first downbeat), downbeatSure, confidence, sure }   key: { camelot, name, root, mode, confidence, sure }
 *   null means "couldn't find one" (e.g. no steady beat, or drums only).
 */
export function analyzeTrack(mono, sampleRate) {
  const started = Date.now();
  const { samples, sampleRate: rate } = downsample(mono, sampleRate);
  const tempo = detectTempo(samples, rate);
  if (tempo) {
    // Move the first beat on to the first "1" of a bar, so bars line up.
    const down = findDownbeat(samples, rate, tempo.bpm, tempo.firstBeat);
    tempo.firstBeat += (down.offset * 60) / tempo.bpm;
    tempo.downbeatSure = down.sure;
  }
  return {
    tempo: judge(tempo),
    key: judge(detectKey(samples, rate)),
    seconds: (Date.now() - started) / 1000,
  };
}

/** Below this confidence we say "not found" rather than guess. */
export const SHOW_FROM = 0.3;
/** From here on we're sure; in between, the answer is shown with a "?". */
export const SURE_FROM = 0.6;

/** Drop answers too weak to show, and mark the ones we're sure of. */
export function judge(result) {
  if (!result || result.confidence < SHOW_FROM) return null;
  return { ...result, sure: result.confidence >= SURE_FROM };
}
