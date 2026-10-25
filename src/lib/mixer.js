/**
 * Crossfader: how loud each deck is for a given fader position.
 *
 * Position runs from -1 (all deck A) through 0 (both) to +1 (all deck B).
 * We use an "equal-power" curve: in the middle each deck is at about 71%,
 * not 50%, so the overall loudness stays even while you fade. A straight
 * 50/50 line would make the mix dip in volume in the middle.
 *
 * @param {number} position  -1..1
 * @returns {{ a: number, b: number }}  gains 0..1
 */
export function crossfadeGains(position) {
  const p = clamp(Number.isFinite(position) ? position : 0, -1, 1);
  const t = (p + 1) / 2; // 0..1
  return { a: Math.cos((t * Math.PI) / 2), b: Math.sin((t * Math.PI) / 2) };
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Time as m:ss (or h:mm:ss for long mixes). Never shows negative numbers.
 * @param {number} seconds
 */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Cue button, CDJ style.
 *  - Paused:  pressing Cue sets the cue point where you are.
 *  - Playing: pressing Cue jumps back to the cue point and stops.
 *
 * @param {{ playing: boolean, position: number, cue: number }} state
 * @returns {{ playing: boolean, position: number, cue: number }}
 */
export function pressCue(state) {
  if (state.playing) return { playing: false, position: state.cue, cue: state.cue };
  return { playing: false, position: state.position, cue: state.position };
}
