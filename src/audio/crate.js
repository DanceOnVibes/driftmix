/**
 * The crate: every track already in DriftMix (the Files list and the Auto DJ
 * playlist, each once), with what was read from it, so the match light can
 * suggest what fits next (lib/crate.js) and load it in one tap.
 */
import { files } from "./files.js";
import { autoDj } from "./autodj.js";
import { decks } from "./engine.js";
import { keyOf } from "./keep.js";
import { crateFits } from "../lib/crate.js";
import { tidyName } from "../lib/files/naming.js";

/** Each track once: { id, name, file, found: { tempo, key }, bpm, camelot }. */
export function crate() {
  const seen = new Map();
  for (const t of autoDj.tracks) {
    if (t.status !== "ready" || !t.found) continue;
    seen.set(keyOf(t.file), { name: t.name, file: t.file, found: t.found });
  }
  for (const it of files.items) {
    if (it.status === "failed" || !it.found) continue;
    const k = keyOf(it.file);
    if (!seen.has(k)) seen.set(k, { name: it.title || tidyName(it.file.name), file: it.file, found: it.found });
  }
  return [...seen.entries()].map(([id, t]) => ({ id, ...t, bpm: t.found.tempo?.bpm ?? null, camelot: t.found.key?.camelot ?? null }));
}

/** Up to three tracks from the crate that fit after `now` (as heard), not already on a deck. */
export function fitsAfter(now, max = 3) {
  const onDecks = new Set([decks.a, decks.b].filter((d) => d.loaded).map((d) => keyOf(d.loaded.file)));
  const pool = crate().filter((t) => !onDecks.has(t.id));
  const best = crateFits({ bpm: now.playingBpm, camelot: now.playingCamelot }, pool, max);
  const byId = new Map(pool.map((t) => [t.id, t]));
  return best.map((f) => ({ ...f, file: byId.get(f.id).file, found: byId.get(f.id).found }));
}

/** Load a crate track onto a deck, with its tempo and key already read. */
export function loadFromCrate(deck, fit) {
  return deck.load(fit.file, { known: fit.found?.tempo ? fit.found : null });
}
