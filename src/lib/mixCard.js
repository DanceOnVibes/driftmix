/**
 * The mix card: what goes on the image made after a recorded set (the
 * drawing itself is in audio/mixCard.js). Kept here so it can be tested.
 */
import { stamp } from "./bridge.js";

const MAX_KEYS = 12;
const bpmText = (x) => {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * @param {{ at: number, name: string, camelot?: string|null, bpm?: number|null }[]} entries the tracklist
 * @param {number} seconds the length of the set
 * @returns {{ length: string, tracks: number, tempo: string, keyPath: string[], lines: { time: string, name: string, key: string }[], more: number, size: number }}
 */
export function cardLayout(entries, seconds) {
  const list = entries.filter((e) => e && e.name);
  // The key path: each key once per run (8A, 8A, 9A → 8A, 9A); a long one keeps its start and end.
  const keys = [];
  for (const e of list) if (e.camelot && keys[keys.length - 1] !== e.camelot) keys.push(e.camelot);
  const keyPath = keys.length > MAX_KEYS ? [...keys.slice(0, MAX_KEYS - 2), "…", keys[keys.length - 1]] : keys;
  // The tempo: one number, or where the set started and finished.
  const bpms = list.map((e) => e.bpm).filter((b) => b > 0);
  let tempo = "";
  if (bpms.length) {
    const first = bpmText(bpms[0]);
    const last = bpmText(bpms[bpms.length - 1]);
    tempo = first === last ? `${first} BPM` : `${first} → ${last} BPM`;
  }
  // The tracklist: bigger type for a short set; a long one ends with "+N more".
  const size = list.length <= 13 ? 40 : 32;
  const room = size === 40 ? 13 : 17;
  const fits = list.length <= room ? list.length : room - 1;
  const long = seconds >= 3600;
  const lines = list.slice(0, fits).map((e) => {
    const t = stamp(e.at);
    return { time: long && e.at < 3600 ? `0:${t}` : t, name: e.name, key: e.camelot || "" };
  });
  return { length: stamp(seconds), tracks: list.length, tempo, keyPath, lines, more: list.length - fits, size };
}
