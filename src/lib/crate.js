/**
 * "From your crate": the tracks already in DriftMix (Files and the Auto DJ
 * playlist) that would mix well after the one playing — for when the match
 * light says the loaded pair doesn't fit, or the next deck is empty.
 */
import { tempoMatch, keyMatch } from "./match.js";

const RANK = { green: 0, amber: 1, red: 2 };

/**
 * @param {{ bpm: number|null, camelot: string|null }} now  the playing track, as heard
 * @param {{ id: string, name: string, bpm: number|null, camelot: string|null }[]} pool
 * @param {number} [max]
 * @returns {{ id: string, name: string, bpm: number, camelot: string, why: string }[]}
 *   best first; only tracks whose tempo and key both fit (green), or one
 *   green and the other mixable with care (amber)
 */
export function crateFits(now, pool, max = 3) {
  if (!(now?.bpm > 0) || !now.camelot) return [];
  const scored = [];
  for (const t of pool) {
    if (!(t.bpm > 0) || !t.camelot) continue;
    const tempo = tempoMatch(now.bpm, t.bpm);
    const key = keyMatch(now.camelot, t.camelot);
    if (!tempo || !key) continue;
    const r = RANK[tempo.level] + RANK[key.level];
    if (tempo.level === "red" || key.level === "red" || r > 1) continue;
    const why = [tempo.label === "Same tempo" ? "same tempo" : `${tempo.percent < 0.95 ? "<1" : Math.round(tempo.percent)}% tempo`, key.label.toLowerCase()].join(" · ");
    // Same key first, then relative, then a neighbour (among equally good tempos).
    const keyNudge = key.label === "Same key" ? 0 : key.label.startsWith("Relative") ? 0.3 : 0.6;
    scored.push({ id: t.id, name: t.name, bpm: t.bpm, camelot: t.camelot, why, score: r * 100 + tempo.percent + keyNudge });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, max).map(({ score, ...rest }) => rest);
}
