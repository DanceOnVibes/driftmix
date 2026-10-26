/**
 * Do two tracks mix? The match light (step 4).
 *
 * Tempo: the transition button will stretch the next track to the playing
 * track's tempo with key lock (the pitch stays put). Small stretches sound
 * natural; past about 6% you start to hear it.
 *   green  ≤ 3%     amber  ≤ 6%     red  more than 6%
 *   (Half and double time count too: 64 against 128 is a match.)
 *
 * Key, on the Camelot wheel:
 *   green  same code, one step round (7A↔8A), or the A/B swap (7A↔7B)
 *   amber  two steps round (energy boost or drop), or a diagonal (7A↔8B, mood shift)
 *   red    anything further: the notes clash
 *
 * The overall light is the worse of the two.
 */
import { parseCamelot } from "./camelot.js";

export const TEMPO_GREEN = 3;
export const TEMPO_AMBER = 6;
const LEVELS = ["green", "amber", "red"];

/** Steps round the wheel between two numbers, 0–6. */
function wheelSteps(a, b) {
  const d = (((b - a) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/** +1 when b is one step clockwise of a (7→8), −1 anticlockwise. */
function wheelDirection(a, b) {
  const d = (((b - a) % 12) + 12) % 12;
  return d === 0 ? 0 : d <= 6 ? 1 : -1;
}

/**
 * How two keys sit together.
 * @returns {{ level: "green"|"amber"|"red", label: string }}
 */
export function keyMatch(fromCode, toCode) {
  const a = parseCamelot(fromCode);
  const b = parseCamelot(toCode);
  if (!a || !b) return null;
  const steps = wheelSteps(a.number, b.number);
  const sameLetter = a.letter === b.letter;
  if (steps === 0 && sameLetter) return { level: "green", label: "Same key" };
  if (steps === 0) return { level: "green", label: "Relative key (A/B swap)" };
  if (steps === 1 && sameLetter) return { level: "green", label: "Neighbour on the wheel" };
  if (steps === 2 && sameLetter) {
    const up = wheelDirection(a.number, b.number) > 0;
    return { level: "amber", label: up ? "Energy boost (+2)" : "Energy drop (−2)" };
  }
  if (steps === 1) return { level: "amber", label: "Mood shift (diagonal)" };
  return { level: "red", label: "Keys clash" };
}

/** The codes that mix cleanly (green) with a key, e.g. 8A → 8A, 7A, 9A, 8B. */
export function friendlyCodes(code) {
  const c = parseCamelot(code);
  if (!c) return [];
  const wrap = (n) => ((n - 1 + 12) % 12) + 1;
  const other = c.letter === "A" ? "B" : "A";
  return [`${c.number}${c.letter}`, `${wrap(c.number - 1)}${c.letter}`, `${wrap(c.number + 1)}${c.letter}`, `${c.number}${other}`];
}

/**
 * Where a key lands after shifting the pitch by whole semitones.
 * One semitone up moves 7 steps round the wheel; one down moves 5.
 */
export function shiftCamelot(code, semitones) {
  const c = parseCamelot(code);
  if (!c) return null;
  const n = ((((c.number - 1 + 7 * semitones) % 12) + 12) % 12) + 1;
  return `${n}${c.letter}`;
}

/**
 * Pitch shifts for the next track that would turn the key light green.
 * ±1 semitone first (sounds most natural), then ±2. Never more.
 * @returns {{ semitones: number, code: string }[]}
 */
export function keyFixes(nowCode, nextCode) {
  const out = [];
  for (const semitones of [1, -1, 2, -2]) {
    const code = shiftCamelot(nextCode, semitones);
    if (code && keyMatch(nowCode, code)?.level === "green") out.push({ semitones, code });
  }
  return out;
}

/**
 * How two tempos sit together.
 * @returns {{ level, percent, target, factor, label }}
 *   percent: how much the next track must stretch; target: the BPM it plays at;
 *   factor: 1, 2 or 0.5 when half/double time is the closer fit.
 */
export function tempoMatch(nowBpm, nextBpm) {
  if (!(nowBpm > 0) || !(nextBpm > 0)) return null;
  let best = null;
  for (const factor of [1, 2, 0.5]) {
    const percent = (Math.abs(nowBpm - nextBpm * factor) / (nextBpm * factor)) * 100;
    if (!best || percent < best.percent - 1e-9) best = { factor, percent };
  }
  const { factor, percent } = best;
  const level = percent <= TEMPO_GREEN ? "green" : percent <= TEMPO_AMBER ? "amber" : "red";
  const diff = Math.abs(nowBpm - nextBpm * factor);
  const label =
    diff < 0.05
      ? "Same tempo"
      : `${factor === 1 ? "" : factor === 2 ? "Double time, " : "Half time, "}${round1(diff)} BPM apart (${round1(percent)}%)`;
  return { level, percent, target: nowBpm, factor, label };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function worst(...levels) {
  return levels.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), "green");
}

/**
 * The whole verdict for the match light.
 * `now` is the playing deck, `next` the one coming in. Each: { id, analysis }.
 * @returns {{ level: "green"|"amber"|"red"|"waiting"|"unknown", headline: string,
 *             tempo, key, tips: string[], unsure: boolean }}
 */
export function assessMatch(now, next) {
  const tips = [];
  const A = now.id.toUpperCase();
  const B = next.id.toUpperCase();
  const na = now.analysis;
  const nb = next.analysis;
  if (!na || !nb || na.status === "none" || nb.status === "none") {
    return { level: "waiting", headline: "Load a track on both decks", tempo: null, key: null, tips, unsure: false };
  }
  if (na.status === "working" || nb.status === "working") {
    return { level: "waiting", headline: "Reading tempo and key…", tempo: null, key: null, tips, unsure: false };
  }

  const tempo = na.tempo && nb.tempo ? tempoMatch(na.tempo.bpm, nb.tempo.bpm) : null;
  const key = na.key && nb.key ? keyMatch(na.key.camelot, nb.key.camelot) : null;
  const unsure = Boolean((na.tempo && !na.tempo.sure) || (nb.tempo && !nb.tempo.sure) || (na.key && !na.key.sure) || (nb.key && !nb.key.sure));

  if (tempo) {
    if (tempo.level === "red") {
      const lo = Math.round(na.tempo.bpm / (1 + TEMPO_AMBER / 100));
      const hi = Math.round(na.tempo.bpm * (1 + TEMPO_AMBER / 100));
      tips.push(`Tempos are too far apart to blend cleanly. For ${A} at ${fmt(na.tempo.bpm)} BPM, pick a track between ${lo} and ${hi} BPM.`);
    } else if (tempo.label !== "Same tempo") {
      const nextIsSlower = nb.tempo.bpm * tempo.factor < na.tempo.bpm;
      tips.push(`The transition will ${nextIsSlower ? "speed up" : "slow down"} ${B} to ${fmt(na.tempo.bpm)} BPM, keeping its key.`);
    }
  } else {
    tips.push(`Tempo not found on ${!na.tempo ? A : B}, so the tempo can't be judged.`);
  }

  if (key) {
    if (key.level !== "green") {
      const fixes = keyFixes(na.key.camelot, nb.key.camelot);
      if (fixes.length) {
        const f = fixes[0];
        tips.push(`Shift ${B} ${f.semitones > 0 ? "up" : "down"} ${Math.abs(f.semitones)} semitone${Math.abs(f.semitones) > 1 ? "s" : ""} (${nb.key.camelot} → ${f.code}) to make the keys match.`);
      }
      if (key.level === "red") tips.push(`Or pick a track in ${friendlyCodes(na.key.camelot).join(", ")}.`);
      if (key.level === "amber" && key.label.startsWith("Energy")) tips.push("A two-step jump works for a lift; keep the blend short.");
    }
  } else {
    tips.push(`Key not found on ${!na.key ? A : B}, so the key can't be judged. Trust your ears.`);
  }
  if (unsure) tips.push("One of the readings has a ?, so check by ear.");

  const known = [tempo?.level, key?.level].filter(Boolean);
  if (!known.length) return { level: "unknown", headline: "Can't judge these two", tempo, key, tips, unsure };
  const level = worst(...known);
  const headline =
    known.length < 2
      ? "Only partly checked"
      : level === "green"
        ? "Good match"
        : level === "amber"
          ? "Mixable, with care"
          : "Not a clean match";
  return { level: known.length < 2 && level === "green" ? "amber" : level, headline, tempo, key, tips, unsure };
}

function fmt(bpm) {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}
