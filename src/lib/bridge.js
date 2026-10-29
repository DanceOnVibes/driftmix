/**
 * Planning for the moments two tracks can't simply blend, and for the
 * tempo journey. Pure maths, tested without sound.
 *
 * Echo-out bridge (what DJs do when two tracks won't beat-match): on a phrase
 * line the playing track is filtered up and fed into an echo while a riser
 * builds; two bars later the dry track cuts, the echoes ring out, and the next
 * track drops on its own first beat, at its own tempo and in its own key.
 * Nothing has to line up, so nothing can clash.
 */
import { tempoMatch, keyMatch, keyFixes, TEMPO_AMBER } from "./match.js";

/**
 * When the bridge starts and when the next track drops.
 * @param {{ bpm: number, firstBeat: number, position: number, speed: number, duration: number }} now
 *   bpm and firstBeat as in the file; position in track seconds; speed = track s per real s
 * @param {{ lead?: number, echoBars?: number, phraseBars?: number }} [o]
 * @returns {{ startTrack: number, startIn: number, dropIn: number, beat: number, echoBars: number, fits: boolean }}
 *   startIn / dropIn: real seconds from now; beat: one beat in real seconds
 */
export function planBridge(now, { lead = 0.5, echoBars = 2, phraseBars = 8 } = {}) {
  const beatTrack = 60 / now.bpm;
  const beat = beatTrack / now.speed;
  const earliest = now.position + lead * now.speed;
  const lastStart = now.duration - echoBars * 4 * beatTrack;
  // The next phrase line if it fits before the end, else the next bar line.
  const line = (every) => now.firstBeat + Math.max(0, Math.ceil((earliest - now.firstBeat) / (every * beatTrack) - 1e-9)) * every * beatTrack;
  let startTrack = line(phraseBars * 4);
  if (startTrack > lastStart) startTrack = line(4);
  const fits = startTrack <= lastStart + 1e-9;
  if (!fits) startTrack = Math.max(earliest, lastStart);
  const startIn = (startTrack - now.position) / now.speed;
  return { startTrack, startIn, dropIn: startIn + echoBars * 4 * beat, beat, echoBars, fits };
}

/**
 * Blend, bridge or skip, for the next track.
 * @param {object} o
 * @param {number} o.nowBpm      what the audience hears now
 * @param {string|null} o.nowKey the playing key (Camelot)
 * @param {number|null} o.nextBpm the next track's own tempo (null = no steady beat)
 * @param {string|null} o.nextKey
 * @param {boolean} o.bridge     echo-out bridge allowed
 * @param {number|null} o.setBpm a locked set tempo, or null (journey)
 * @returns {{ kind: "blend"|"bridge"|"skip", why: string, targetBpm: number|null }}
 *   targetBpm: the tempo the next track should play at after a bridge (null = its own)
 */
export function chooseMix({ nowBpm, nowKey, nextBpm, nextKey, bridge, setBpm = null }) {
  if (!(nextBpm > 0)) return bridge ? { kind: "bridge", why: "no steady beat to match", targetBpm: null } : { kind: "skip", why: "no steady beat found", targetBpm: null };
  const fitsSet = setBpm > 0 && tempoMatch(setBpm, nextBpm).percent <= TEMPO_AMBER;
  const targetBpm = fitsSet ? setBpm : null;
  const tempo = tempoMatch(nowBpm, nextBpm);
  if (tempo.level === "red") {
    const why = `${round1(tempo.percent)}% apart in tempo`;
    return bridge ? { kind: "bridge", why, targetBpm } : { kind: "skip", why, targetBpm };
  }
  if (bridge && nowKey && nextKey) {
    const km = keyMatch(nowKey, nextKey);
    if (km?.level === "red" && !keyFixes(nowKey, nextKey).length) return { kind: "bridge", why: "keys clash", targetBpm };
  }
  return { kind: "blend", why: "", targetBpm };
}

/**
 * Tempo journey: after a blend the new track plays at the tempo it was
 * matched to. It settles to its own tempo on the next 8-bar phrase line at
 * least `lead` real seconds away (and before its last phrase).
 * @returns {number|null}  track seconds of that line, or null if there's none
 */
export function settlePoint({ bpm, firstBeat, position, speed, duration }, { lead = 4, phraseBars = 8 } = {}) {
  const phrase = phraseBars * 4 * (60 / bpm);
  const earliest = position + lead * speed;
  const k = Math.max(0, Math.ceil((earliest - firstBeat) / phrase - 1e-9));
  const at = firstBeat + k * phrase;
  return at < duration - phrase ? at : null;
}

/** "1:02:33" or "4:05" from seconds (tracklists, YouTube chapters). */
export function stamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/**
 * A tracklist as text, one line per track: "00:00 Inspiration".
 * Over an hour every line gets hours, so they line up (YouTube reads both).
 * @param {{ at: number, name: string }[]} entries  at: seconds into the recording
 */
export function tracklistText(entries) {
  const long = entries.some((e) => e.at >= 3600);
  return entries
    .map((e) => {
      const t = stamp(e.at);
      return `${long && !t.includes(":", 3) && e.at < 3600 ? `0:${t}` : t} ${e.name}`;
    })
    .join("\n");
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
