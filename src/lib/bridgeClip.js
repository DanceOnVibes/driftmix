/**
 * Bridges: short beat-only clips (drums, percussion, a riser) that Auto DJ
 * plays between two tracks. Track A blends into the clip, the clip carries
 * the beat on its own for a few bars, then track B blends in. A clip with no
 * melody has no key, so two tracks whose keys clash never meet.
 *
 *  - trimClip: where a clip's whole bars are (from its first downbeat; 4, 8
 *    or 16 bars, whichever fits), so it loops on the beat
 *  - loopClip: the clip repeated to the length a bridge needs, each repeat
 *    joined just before the downbeat with an 8 ms crossfade
 *  - bridgeDue: does this pair of tracks get a bridge?
 *  - clipBpmFromName: "Bridge 03 – drums 128.wav" → 128, for clips too short
 *    or sparse to read a tempo from
 *
 * Plain maths on Float32Arrays: tested without a browser.
 */
import { keyMatch } from "./match.js";

export const CLIP_BARS = [16, 8, 4];
export const BRIDGE_BLEND_BARS = 8; // blend into the bridge, and out of it
export const BRIDGE_SOLO_BARS = 8; // the bridge on its own in between
export const BRIDGE_BARS = BRIDGE_BLEND_BARS * 2 + BRIDGE_SOLO_BARS;
export const CLIP_MODES = ["every", "clash", "off"];

/**
 * A clip is made to start on its first kick, and in a drums-only loop the
 * "downbeat" reading can land on any beat, so the clip starts on the first
 * beat of the grid, not the first detected downbeat.
 * @param {number} seconds  the clip's length
 * @param {{ bpm: number, firstBeat: number }} grid
 * @returns {{ start: number, bars: number, end: number } | null}  seconds; null if under 4 bars
 */
export function trimClip(seconds, { bpm, firstBeat }) {
  if (!(bpm > 0) || !(seconds > 0)) return null;
  const beat = 60 / bpm;
  const bar = beat * 4;
  // The grid's first beat: the detected one moved back by whole beats.
  let start = Math.max(0, firstBeat || 0);
  while (start - beat >= -0.01) start = Math.max(0, start - beat);
  const fits = (seconds - start) / bar + 0.02; // a hair of slack for rounding
  const bars = CLIP_BARS.find((b) => b <= fits);
  return bars ? { start, bars, end: start + bars * bar } : null;
}

/**
 * The clip [start, end) (seconds) repeated to `totalBars` bars.
 * @param {Float32Array[]} channels
 * @returns {Float32Array[]}
 */
export function loopClip(channels, sampleRate, { start, end, bars }, totalBars) {
  const a = Math.round(start * sampleRate);
  const b = Math.min(channels[0].length, Math.round(end * sampleRate));
  const len = b - a;
  if (len <= 0) throw new Error("empty clip");
  const copies = Math.max(1, Math.ceil(totalBars / bars));
  const fade = Math.round(0.008 * sampleRate);
  const lead = Math.round(0.002 * sampleRate);
  return channels.map((x) => {
    const out = new Float32Array(len * copies);
    for (let k = 0; k < copies; k++) {
      out.set(x.subarray(a, b), k * len);
      if (k > 0) {
        // Just before each downbeat, the clip's own lead-in fades in under its ending.
        const f = Math.min(fade, a, len);
        for (let i = 0; i < f; i++) {
          const t = (i + 0.5) / f;
          const at = k * len - f + i;
          out[at] = out[at] * (1 - t) + x[a - f + i] * t;
        }
      }
    }
    for (let i = 0; i < Math.min(lead, out.length); i++) out[i] *= (i + 0.5) / lead;
    return out;
  });
}

/**
 * Does Auto DJ put a bridge between these two tracks?
 * @param {"every"|"clash"|"off"} mode
 * @param {string|null} fromKey  Camelot keys as they play
 * @param {string|null} toKey
 */
export function bridgeDue(mode, fromKey, toKey) {
  if (mode === "every") return true;
  if (mode === "clash") return keyMatch(fromKey, toKey)?.level === "red";
  return false;
}

/** A tempo written in a clip's name: "drums 128", "128 BPM", "128bpm" → 128 (60–200), else null. */
export function clipBpmFromName(name) {
  const s = String(name || "").replace(/\.[a-z0-9]+$/i, "");
  const m = /(\d{2,3}(?:[.,]\d+)?)\s*bpm/i.exec(s) || /(?:^|[^\d])(\d{2,3})(?:[^\d]|$)(?!.*\d{2,3})/.exec(s);
  const n = m ? Number(m[1].replace(",", ".")) : NaN;
  return n >= 60 && n <= 200 ? n : null;
}
