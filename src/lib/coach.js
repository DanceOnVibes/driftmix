/**
 * The coach: after each mix, one or two plain sentences on what DriftMix
 * just did and why, so Auto DJ teaches the moves instead of hiding them.
 */
import { keyMatch } from "./match.js";

const bpmText = (x) => {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * @param {object} o
 * @param {"blend"|"bridge"|"buildUp"} o.kind
 * @param {number} [o.bars]        blend length
 * @param {boolean} [o.phrase]     waited for the phrase line (8 bars), not just the next bar
 * @param {string} o.to            the deck that came in ("A" or "B")
 * @param {string|null} o.fromKey  Camelot, as heard
 * @param {string|null} o.toKey    Camelot, as heard (after any key shift)
 * @param {number|null} o.toNativeBpm  the incoming track's own tempo
 * @param {number|null} o.toHeardBpm   the tempo it played at
 * @param {number} [o.semitones]   key shift on the incoming track
 * @param {string} [o.why]         why an echo-out was chosen ("keys clash", …)
 */
export function coachLine(o) {
  const parts = [];
  if (o.kind === "bridge") {
    parts.push(`Echo-out${o.why ? ` (${o.why})` : ""}: the old track echoed away and ${o.to} dropped on its first beat, so nothing had to blend.`);
  } else if (o.kind === "buildUp") {
    parts.push(`Build-up: a one-beat snippet rolled faster and faster, then ${o.to} dropped on the beat.`);
  } else {
    parts.push(`${o.bars}-bar blend, started on the ${o.phrase ? "phrase line (every 8 bars)" : "next bar"}; the basses swapped half way so two kicks never fought.`);
  }
  const native = o.toNativeBpm;
  const heard = o.toHeardBpm;
  if (native > 0 && heard > 0) {
    if (Math.abs(native - heard) >= 0.05) parts.push(`${o.to} played at ${bpmText(heard)} BPM instead of its own ${bpmText(native)} to match.`);
    else parts.push(`Same tempo, ${bpmText(heard)} BPM.`);
  }
  const k = o.fromKey && o.toKey ? keyMatch(o.fromKey, o.toKey) : null;
  if (k) {
    const verdict = k.label.charAt(0).toLowerCase() + k.label.slice(1);
    if (o.semitones) {
      const s = `${o.semitones > 0 ? "+" : "−"}${Math.abs(o.semitones)}`;
      parts.push(`Key shifted ${s} semitone${Math.abs(o.semitones) > 1 ? "s" : ""}, so ${o.fromKey} → ${o.toKey}: ${verdict}.`);
    } else parts.push(`Keys ${o.fromKey} → ${o.toKey}: ${verdict}.`);
  }
  return parts.join(" ");
}
