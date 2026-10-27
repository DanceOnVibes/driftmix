/**
 * Auto DJ set planning: put a playlist in an order that flows.
 *
 * The whole set plays at one tempo: the first track's (a tempo lock, like a
 * DJ who keeps the room at 128). Every other track is stretched to it, so a
 * track more than 6% away can't join the set cleanly.
 *
 * Order is about keys: each step should be green on the Camelot wheel where
 * possible. Cost of one step (lower is better):
 *   green 0 · fixable with a ±1 semitone shift 2 · amber 3 · fixable ±2 4 ·
 *   unknown key 4 · clash 10
 * We start from the first track, always pick the cheapest next track
 * ("nearest neighbour"), then tidy up by reversing stretches of the order
 * when that lowers the total ("2-opt").
 */
import { keyMatch, keyFixes, tempoMatch, TEMPO_AMBER } from "./match.js";

/** @typedef {{ id: string, bpm: number|null, camelot: string|null }} SetTrack */

export function stepCost(from, to) {
  if (!from.camelot || !to.camelot) return 4;
  const level = keyMatch(from.camelot, to.camelot)?.level;
  if (level === "green") return 0;
  const fix = keyFixes(from.camelot, to.camelot)[0];
  if (fix && Math.abs(fix.semitones) === 1) return 2;
  if (level === "amber") return 3;
  if (fix) return 4;
  return 10;
}

function pathCost(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += stepCost(path[i - 1], path[i]);
  return total;
}

/** Can this track join a set locked at `setBpm`? */
export function fitsTempo(track, setBpm) {
  if (!(track.bpm > 0) || !(setBpm > 0)) return false;
  return tempoMatch(setBpm, track.bpm).percent <= TEMPO_AMBER;
}

/**
 * @param {SetTrack[]} tracks  in the current order; the first one starts the set
 * @returns {{ order: SetTrack[], left: SetTrack[], cost: number, setBpm: number|null }}
 *   order: the set; left: tracks that can't join (tempo too far, or no tempo found)
 */
export function orderSet(tracks) {
  if (!tracks.length) return { order: [], left: [], cost: 0, setBpm: null };
  const first = tracks.find((t) => t.bpm > 0);
  if (!first) return { order: [], left: [...tracks], cost: 0, setBpm: null };
  const setBpm = first.bpm;
  const fits = tracks.filter((t) => t !== first && fitsTempo(t, setBpm));
  const left = tracks.filter((t) => t !== first && !fitsTempo(t, setBpm));

  // Nearest neighbour from the first track.
  const order = [first];
  const pool = [...fits];
  while (pool.length) {
    const last = order[order.length - 1];
    let best = 0;
    for (let i = 1; i < pool.length; i++) if (stepCost(last, pool[i]) < stepCost(last, pool[best])) best = i;
    order.push(pool.splice(best, 1)[0]);
  }

  // 2-opt: reverse any stretch (after the first track) that lowers the total.
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (pathCost(candidate) < pathCost(order)) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return { order, left, cost: pathCost(order), setBpm };
}

/** Real seconds left on a deck before the set must start mixing out. */
export function mixOutIn({ position, duration, speed, bpm, bars, prep = 6 }) {
  const remainingReal = (duration - position) / speed;
  const blend = (bars * 4 * 60) / (bpm * speed);
  return remainingReal - blend - prep;
}
