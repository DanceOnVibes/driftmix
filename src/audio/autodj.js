/**
 * Auto DJ: a playlist that mixes itself.
 *
 *  - Add tracks: each is read in the background (tempo and key), one at a
 *    time, and the decoded audio is let go afterwards to save memory.
 *  - Order: "smooth set" puts keys in a flowing order (see lib/setlist.js).
 *  - Start: track 1 plays on deck A, track 2 waits on deck B. Near the end
 *    of each track, Auto DJ presses Mix (key fix on), then loads the next
 *    track onto the deck that just finished. Until the playlist runs out.
 *  - The whole set stays at the first track's tempo. Tracks more than 6%
 *    away are skipped, with a note.
 *  - Touching a deck hands control back to you (Auto DJ switches off).
 */
import { audioContext, decks, setCrossfader } from "./engine.js";
import { analyzeBuffer } from "./analysis.js";
import { mix, isActive, nowAndNext, transitionOptions, startTransition, cancelTransition } from "./transition.js";
import { orderSet, fitsTempo, mixOutIn } from "../lib/setlist.js";

const AUDIO_NAME = /\.(mp3|wav|flac|aiff?|m4a|aac|ogg|opus)$/i;

export const autoDj = {
  /** @type {{ id: string, file: File, name: string, status: "reading"|"ready"|"failed", tempo: object|null, key: object|null, duration: number }[]} */
  tracks: [],
  on: false,
  bars: 16,
  setBpm: null, // the set's locked tempo while running
  onDeck: { a: null, b: null }, // which playlist track is on each deck
  message: "",
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

let nextId = 1;
let reading = Promise.resolve();
let timer = null;
let busy = false; // Auto DJ is loading or starting something itself

// ---- the playlist ------------------------------------------------------

export function addTracks(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("audio/") || AUDIO_NAME.test(f.name));
  for (const file of files) {
    const track = { id: String(nextId++), file, name: file.name.replace(/\.[^.]+$/, ""), status: "reading", tempo: null, key: null, duration: 0 };
    autoDj.tracks.push(track);
    reading = reading.then(() => readTrack(track));
  }
  autoDj.emit();
  return files.length;
}

async function readTrack(track) {
  if (!autoDj.tracks.includes(track)) return;
  try {
    const buffer = await audioContext().decodeAudioData(await track.file.arrayBuffer());
    track.duration = buffer.duration;
    const result = await analyzeBuffer(buffer);
    track.tempo = result.tempo;
    track.key = result.key;
    track.status = "ready";
  } catch {
    track.status = "failed";
  }
  autoDj.emit();
}

const isLive = (id) => autoDj.on && (autoDj.onDeck.a === id || autoDj.onDeck.b === id);

export function removeTrack(id) {
  if (isLive(id)) return;
  autoDj.tracks = autoDj.tracks.filter((t) => t.id !== id);
  autoDj.emit();
}

export function moveTrack(id, step) {
  const list = autoDj.tracks;
  const i = list.findIndex((t) => t.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  autoDj.emit();
}

export function clearTracks() {
  if (autoDj.on) return;
  autoDj.tracks = [];
  autoDj.message = "";
  autoDj.emit();
}

/** "Order for a smooth set": flowing keys, first track stays first. */
export function sortSet() {
  if (autoDj.on) return;
  const ready = autoDj.tracks.filter((t) => t.status === "ready");
  const others = autoDj.tracks.filter((t) => t.status !== "ready");
  const { order, left, setBpm } = orderSet(ready.map((t) => ({ id: t.id, bpm: t.tempo?.bpm ?? null, camelot: t.key?.camelot ?? null })));
  const byId = new Map(ready.map((t) => [t.id, t]));
  autoDj.tracks = [...order.map((o) => byId.get(o.id)), ...left.map((o) => byId.get(o.id)), ...others];
  autoDj.message = left.length
    ? `${left.length} track${left.length > 1 ? "s are" : " is"} too far from ${fmt(setBpm)} BPM (or had no tempo): moved to the end, Auto DJ will skip ${left.length > 1 ? "them" : "it"}.`
    : order.length > 1
      ? `Ordered for flowing keys, all at ${fmt(setBpm)} BPM.`
      : "";
  autoDj.emit();
}

/** The set's tempo: the first track that has one. */
export function setTempo() {
  return autoDj.tracks.find((t) => t.status === "ready" && t.tempo)?.tempo.bpm ?? null;
}

/** Can this track play in the set? */
export function playable(track, setBpm = autoDj.setBpm ?? setTempo()) {
  return track.status === "ready" && Boolean(track.tempo) && fitsTempo({ bpm: track.tempo.bpm }, setBpm);
}

// ---- running the set ----------------------------------------------------

function nextPlayable(afterId) {
  const list = autoDj.tracks;
  const from = afterId ? list.findIndex((t) => t.id === afterId) + 1 : 0;
  const skipped = [];
  for (let i = from; i < list.length; i++) {
    if (playable(list[i])) return { track: list[i], skipped };
    if (list[i].status !== "reading") skipped.push(list[i]);
  }
  return { track: null, skipped };
}

async function loadOnto(deck, track) {
  busy = true;
  try {
    await deck.load(track.file, { known: { tempo: track.tempo, key: track.key }, byApp: true });
    autoDj.onDeck[deck.id] = track.id;
  } finally {
    busy = false;
  }
}

/** Load the track after `afterId` onto `deck`, skipping ones that can't join. */
async function queueAfter(afterId, deck) {
  const { track, skipped } = nextPlayable(afterId);
  if (skipped.length) autoDj.message = `Skipped ${skipped.map((t) => t.name).join(", ")}: too far from ${fmt(autoDj.setBpm)} BPM or unreadable.`;
  if (!track) {
    autoDj.onDeck[deck.id] = null;
    autoDj.emit();
    return null;
  }
  await loadOnto(deck, track);
  autoDj.emit();
  return track;
}

export async function startAutoDj() {
  if (autoDj.on) return;
  const setBpm = setTempo();
  const first = autoDj.tracks.find((t) => playable(t, setBpm));
  if (!first) {
    autoDj.message = "Add at least one track with a readable tempo first.";
    autoDj.emit();
    return;
  }
  cancelTransition("Auto DJ took over.");
  decks.a.stop();
  decks.b.stop();
  autoDj.setBpm = setBpm;
  autoDj.on = true;
  autoDj.onDeck = { a: null, b: null };
  autoDj.message = `Set tempo ${fmt(setBpm)} BPM.`;
  autoDj.emit();

  await loadOnto(decks.a, first);
  setCrossfader(-1);
  busy = true;
  decks.a.startAt(audioContext().currentTime, 0);
  busy = false;
  await queueAfter(first.id, decks.b);
  lastNow = decks.a;
  handled = mix.state;
  timer = setInterval(tick, 250);
  autoDj.emit();
}

export function stopAutoDj(message = "Auto DJ off. The music keeps playing; it's yours now.") {
  if (!autoDj.on) return;
  autoDj.on = false;
  clearInterval(timer);
  timer = null;
  autoDj.message = message;
  autoDj.emit();
}

let lastNow = null;

function tick() {
  if (!autoDj.on || busy || isActive()) return;
  const [now, next] = nowAndNext();
  if (!now.playing) {
    // Nothing playing. If the last track ran out, go straight to the next
    // one (no blend possible); otherwise the music was stopped, so hand back.
    const ended = lastNow && lastNow.buffer && lastNow.offset >= lastNow.duration - 0.5;
    if (!ended) {
      stopAutoDj("Auto DJ off: the music stopped.");
      return;
    }
    const other = lastNow === decks.a ? decks.b : decks.a;
    if (!autoDj.onDeck[other.id]) {
      stopAutoDj("Set finished.");
      return;
    }
    busy = true;
    setCrossfader(other.id === "b" ? 1 : -1);
    other.startAt(audioContext().currentTime, 0);
    busy = false;
    const finished = lastNow;
    autoDj.onDeck[finished.id] = null;
    lastNow = other;
    void queueAfter(autoDj.onDeck[other.id], finished);
    return;
  }
  lastNow = now;
  if (!autoDj.onDeck[next.id] || !next.buffer) return; // last track: let it play out
  const t = now.analysis.tempo;
  if (!t) return;
  const left = mixOutIn({ position: now.position, duration: now.duration, speed: now.speed, bpm: t.bpm, bars: autoDj.bars });
  if (left > 0) return;
  const opts = transitionOptions(now, next);
  if (opts.ok) {
    void startTransition({ bars: autoDj.bars, useFix: true });
    return;
  }
  // Can't mix into this one: skip it and try the track after.
  const skippedId = autoDj.onDeck[next.id];
  autoDj.message = `Skipped ${autoDj.tracks.find((x) => x.id === skippedId)?.name ?? "a track"}: ${opts.reason}`;
  void queueAfter(skippedId, next);
}

// When a transition finishes, load the next track onto the deck that just
// stopped. (Handled once per finished transition.)
let handled = null;
mix.subscribe(() => {
  if (!autoDj.on || mix.state.status !== "done" || handled === mix.state) return;
  handled = mix.state;
  const freeId = mix.state.from;
  const playingTrack = autoDj.onDeck[mix.state.to];
  autoDj.onDeck[freeId] = null;
  lastNow = decks[mix.state.to];
  void queueAfter(playingTrack, decks[freeId]);
});

// The DJ touching a deck hands control back.
for (const deck of Object.values(decks)) {
  deck.touchHandlers.add(() => {
    if (autoDj.on && !busy) stopAutoDj("Auto DJ off: you took over. The music keeps playing.");
  });
}

/** Rough length of the set: every track, minus the overlaps. */
export function setLength() {
  const setBpm = autoDj.setBpm ?? setTempo();
  const list = autoDj.tracks.filter((t) => playable(t, setBpm));
  if (!list.length) return 0;
  const blend = (autoDj.bars * 4 * 60) / setBpm;
  const total = list.reduce((sum, t) => sum + t.duration * (t.tempo.bpm / setBpm), 0);
  return Math.max(0, total - blend * (list.length - 1));
}

export function setBars(n) {
  autoDj.bars = n;
  autoDj.emit();
}

function fmt(bpm) {
  if (!(bpm > 0)) return "–";
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
