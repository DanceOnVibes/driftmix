/**
 * Auto DJ: a playlist that mixes itself.
 *
 *  - Add tracks: each is read in the background (tempo and key), one at a
 *    time, and the decoded audio is let go afterwards to save memory.
 *  - Order: "smooth set" puts keys in a flowing order (see lib/setlist.js).
 *  - Start: track 1 plays on deck A, track 2 waits on deck B. Near the end
 *    of each track, Auto DJ presses Mix (key fix on), then loads the next
 *    track onto the deck that just finished. Until the playlist runs out.
 *  - Tempo: locked (the first track's, or one you pick; every track is
 *    stretched to it), or a journey (each track settles to its own tempo
 *    after its blend, so a set can climb 128 → 135).
 *  - When two tracks can't blend (tempos more than 6% apart, or keys that
 *    clash with no fix), an echo-out bridge takes the set across instead of
 *    skipping the track (unless the bridge is switched off).
 *  - Mixes start on an 8-bar phrase line near the end of each track; tracks
 *    with a "?" tempo get an 8-bar blend so the beats stay tight.
 *  - Touching a deck hands control back to you (Auto DJ switches off).
 */
import { audioContext, decks, setCrossfader } from "./engine.js";
import { analyzeBuffer, stretchBuffer } from "./analysis.js";
import { mix, isActive, nowAndNext, transitionOptions, startTransition, cancelTransition, startBridge } from "./transition.js";
import { orderSet, orderJourney, fitsTempo, mixOutIn, mixOutPoint } from "../lib/setlist.js";
import { chooseMix, settlePoint } from "../lib/bridge.js";
import { tempoMatch, TEMPO_AMBER } from "../lib/match.js";

const AUDIO_NAME = /\.(mp3|wav|flac|aiff?|m4a|aac|ogg|opus)$/i;

export const autoDj = {
  /** @type {{ id: string, file: File, name: string, status: "reading"|"ready"|"failed", tempo: object|null, key: object|null, duration: number }[]} */
  tracks: [],
  on: false,
  bars: 16,
  tempoChoice: "first", // "first" = the first track's tempo, "journey" = each its own, or a number (128 …)
  setBpm: null, // the set's locked tempo while running (null on a journey)
  bridge: true, // echo-out bridge when tracks can't blend (off = skip them)
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

/**
 * Add tracks to the playlist.
 * @param {Iterable<File | { file: File, name: string }>} fileList  files, or files with a title (from Files)
 */
export function addTracks(fileList) {
  const entries = [...fileList].map((f) => (f instanceof Blob ? { file: f, name: f.name.replace(/\.[^.]+$/, "") } : f));
  // Audio only, and each file once (sending from Files twice doesn't double up).
  const files = entries.filter(
    ({ file }) => (file.type.startsWith("audio/") || AUDIO_NAME.test(file.name)) && !autoDj.tracks.some((t) => t.file === file),
  );
  for (const { file, name } of files) {
    const track = { id: String(nextId++), file, name, status: "reading", tempo: null, key: null, duration: 0 };
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

/** "Order for a smooth set": flowing keys, first fitting track stays first. */
export function sortSet() {
  if (autoDj.on) return;
  const ready = autoDj.tracks.filter((t) => t.status === "ready");
  const others = autoDj.tracks.filter((t) => t.status !== "ready");
  if (autoDj.tempoChoice === "journey") {
    const j = orderJourney(ready.map((t) => ({ id: t.id, bpm: t.tempo?.bpm ?? null, camelot: t.key?.camelot ?? null })));
    const byId = new Map(ready.map((t) => [t.id, t]));
    autoDj.tracks = [...j.order.map((o) => byId.get(o.id)), ...j.left.map((o) => byId.get(o.id)), ...others];
    const first = j.order[0];
    const last = j.order[j.order.length - 1];
    autoDj.message =
      j.order.length > 1
        ? `Ordered as a tempo journey: ${fmt(first.bpm)} → ${fmt(last.bpm)} BPM, keys smoothed where tempos are close.${j.left.length ? ` No beat found in ${j.left.length}: moved to the end.` : ""}`
        : "";
    autoDj.emit();
    return;
  }
  const chosen = autoDj.tempoChoice === "first" ? null : Number(autoDj.tempoChoice);
  const { order, left, setBpm } = orderSet(
    ready.map((t) => ({ id: t.id, bpm: t.tempo?.bpm ?? null, camelot: t.key?.camelot ?? null })),
    chosen,
  );
  const byId = new Map(ready.map((t) => [t.id, t]));
  const leftTracks = left.map((o) => byId.get(o.id));
  autoDj.tracks = [...order.map((o) => byId.get(o.id)), ...leftTracks, ...others];
  const bridged = leftTracks.filter((t) => t.tempo && autoDj.bridge);
  const skipped = leftTracks.filter((t) => !bridged.includes(t));
  autoDj.message = leftTracks.length
    ? [
        bridged.length ? `Moved to the end, played with an echo-out bridge (tempo too far to blend): ${bridged.map((t) => `${t.name} (${fmt(t.tempo.bpm)} BPM)`).join("; ")}.` : "",
        skipped.length ? `Moved to the end, Auto DJ will skip: ${skipped.map((t) => `${t.name} (${skipReason(t, setBpm)})`).join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : order.length > 1
      ? `Ordered for flowing keys, all at ${fmt(setBpm)} BPM.`
      : "";
  autoDj.emit();
}

/** The set's tempo: the one picked, or the first track that has one (null on a journey). */
export function setTempo() {
  if (autoDj.tempoChoice === "journey") return null;
  if (autoDj.tempoChoice !== "first") return Number(autoDj.tempoChoice);
  return autoDj.tracks.find((t) => t.status === "ready" && t.tempo)?.tempo.bpm ?? null;
}

export function setTempoChoice(value) {
  if (autoDj.on) return;
  autoDj.tempoChoice = value === "first" || value === "journey" ? value : Number(value);
  autoDj.emit();
}

export function setBridge(on) {
  autoDj.bridge = Boolean(on);
  autoDj.emit();
}

const journey = () => autoDj.tempoChoice === "journey";

/** Can this track play in the set? (On a journey, or with the bridge on, any track with a beat can.) */
export function playable(track, setBpm = autoDj.setBpm ?? setTempo()) {
  if (track.status !== "ready" || !track.tempo) return false;
  if (journey() || autoDj.bridge) return true;
  return fitsTempo({ bpm: track.tempo.bpm }, setBpm);
}

/** Joins with an echo-out bridge rather than a blend (tempo too far from the locked set tempo). */
export function needsBridge(track, setBpm = autoDj.setBpm ?? setTempo()) {
  return Boolean(track.tempo) && !journey() && autoDj.bridge && !fitsTempo({ bpm: track.tempo.bpm }, setBpm);
}

/** Why a track can't play in the set, in plain words ("" if it can). */
export function skipReason(track, setBpm = autoDj.setBpm ?? setTempo()) {
  if (track.status === "failed") return "couldn't read the file";
  if (track.status === "reading") return "still being read";
  if (!track.tempo) return "no steady beat found";
  if (journey() || autoDj.bridge || !(setBpm > 0)) return "";
  const m = tempoMatch(setBpm, track.tempo.bpm);
  if (m.percent > TEMPO_AMBER) return `${fmt(track.tempo.bpm)} BPM is ${round1(m.percent)}% from ${fmt(setBpm)}, the most is 6%`;
  return "";
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
  if (skipped.length) autoDj.message = `Skipped ${skipped.map((t) => `${t.name} (${skipReason(t)})`).join("; ")}.`;
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
  // Start with the first track that fits the set tempo (any track on a journey).
  const first = autoDj.tracks.find((t) => playable(t, setBpm) && !needsBridge(t, setBpm)) || autoDj.tracks.find((t) => playable(t, setBpm));
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
  const intro = setBpm ? `Set tempo ${fmt(setBpm)} BPM.` : "Tempo journey: every track settles to its own tempo after its blend.";
  autoDj.message = intro;
  autoDj.emit();

  await loadOnto(decks.a, first);
  // The first track plays at the set tempo too (on a journey, at its own).
  const ratio = setBpm && !needsBridge(first, setBpm) ? setBpm / (first.tempo.bpm * tempoMatch(setBpm, first.tempo.bpm).factor) : 1;
  if (Math.abs(ratio - 1) > 1e-4) {
    autoDj.message = `Getting ${first.name} to ${fmt(setBpm)} BPM…`;
    autoDj.emit();
    try {
      const stretched = await stretchBuffer(decks.a.buffer, ratio, audioContext());
      if (!autoDj.on) return;
      decks.a.setStretch({ buffer: stretched, stretchTempo: ratio, pitchRate: 1, semitones: 0, heardBpm: setBpm });
    } catch {
      stopAutoDj(`Couldn't get ${first.name} to ${fmt(setBpm)} BPM. Try another first track.`);
      return;
    }
    autoDj.message = intro;
  }
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
  if (now.before) return; // settling to its own tempo right now: wait for it
  const choice = chooseMix({
    nowBpm: now.playingBpm,
    nowKey: now.playingCamelot,
    nextBpm: next.analysis.tempo?.bpm ?? null,
    nextKey: next.analysis.key?.camelot ?? null,
    bridge: autoDj.bridge,
    setBpm: autoDj.setBpm,
  });
  // Tracks with a "?" tempo wander a little: keep their blends short.
  const unsure = !t.sure || !next.analysis.tempo?.sure;
  const bars = choice.kind === "bridge" ? 3 : unsure ? Math.min(8, autoDj.bars) : autoDj.bars;
  // Mix out on the last 8-bar phrase line that leaves room for the blend (or
  // the bridge), starting the preparation a few seconds before it. A bridge
  // that stretches the next track needs longer to get ready.
  const point = mixOutPoint({ firstBeat: t.firstBeat, bpm: t.bpm, duration: now.duration, bars });
  const xt = next.analysis.tempo;
  const ratio = choice.kind === "bridge" && choice.targetBpm && xt ? choice.targetBpm / (xt.bpm * tempoMatch(choice.targetBpm, xt.bpm).factor) : 1;
  const lead = choice.kind === "bridge" && Math.abs(ratio - 1) > 1e-4 ? 9 : 3; // real seconds
  const due =
    point !== null && point > now.position
      ? (point - now.position) / now.speed <= lead
      : mixOutIn({ position: now.position, duration: now.duration, speed: now.speed, bpm: t.bpm, bars }) <= 0;
  if (!due) return;
  const nextName = autoDj.tracks.find((x) => x.id === autoDj.onDeck[next.id])?.name ?? "the next track";
  if (choice.kind === "bridge") {
    autoDj.message = `${nextName}: echo-out bridge (${choice.why}).`;
    autoDj.emit();
    void startBridge({ ratio, heardBpm: choice.targetBpm, why: choice.why });
    return;
  }
  const opts = transitionOptions(now, next);
  if (choice.kind === "blend" && opts.ok) {
    if (bars < autoDj.bars) {
      autoDj.message = "A track with a ? tempo: blending over 8 bars to keep the beats tight.";
      autoDj.emit();
    }
    void startTransition({ bars, useFix: true, phraseBars: point !== null && point > now.position ? 8 : 1 });
    return;
  }
  // Can't mix into this one: skip it and try the track after.
  const skippedId = autoDj.onDeck[next.id];
  autoDj.message = `Skipped ${nextName}: ${opts.ok ? choice.why : opts.reason}`;
  void queueAfter(skippedId, next);
}

// ---- tempo journey: settle to its own tempo ---------------------------------

let settleRun = 0;

/**
 * After a blend on a journey, the new track plays at the tempo it was matched
 * to. On the next phrase line (well before its own mix-out) it settles to its
 * own tempo: a copy at its own tempo (key shift kept) takes over seamlessly.
 */
async function settle(deck) {
  if (!autoDj.on || !journey()) return;
  const t = deck.analysis.tempo;
  if (!t || Math.abs(deck.speed - 1) < 1e-4) return;
  const token = ++settleRun;
  const buffer = deck.buffer;
  const pitch = deck.pitchRate;
  let copy = null;
  try {
    if (Math.abs(pitch - 1) > 1e-6) copy = await stretchBuffer(buffer, 1 / pitch, audioContext());
  } catch {
    return;
  }
  if (token !== settleRun || !autoDj.on || deck.buffer !== buffer || !deck.playing || isActive()) return;
  const mixOut = mixOutPoint({ firstBeat: t.firstBeat, bpm: t.bpm, duration: deck.duration, bars: autoDj.bars }) ?? deck.duration;
  const at = settlePoint({ bpm: t.bpm, firstBeat: t.firstBeat, position: deck.position, speed: deck.speed, duration: mixOut });
  if (at === null) return;
  const ctx = audioContext();
  const when = ctx.currentTime + (at - deck.position) / deck.speed;
  const from = deck.playingBpm;
  busy = true;
  const ok = deck.swapAt(when, { buffer: copy, stretchTempo: copy ? 1 / pitch : 1, pitchRate: pitch, semitones: deck.semitones, heardBpm: null });
  busy = false;
  if (!ok) return;
  const name = autoDj.tracks.find((x) => x.id === autoDj.onDeck[deck.id])?.name ?? "The track";
  autoDj.message = `${name} settles from ${fmt(from)} to its own ${fmt(t.bpm)} BPM on the next phrase.`;
  autoDj.emit();
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
  void settle(decks[mix.state.to]);
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
  const speedOf = (t) => (setBpm && !needsBridge(t, setBpm) ? setBpm / t.tempo.bpm : 1);
  const total = list.reduce((sum, t) => sum + t.duration / speedOf(t), 0);
  const avg = list.reduce((sum, t) => sum + t.tempo.bpm * speedOf(t), 0) / list.length;
  const blend = (autoDj.bars * 4 * 60) / avg;
  return Math.max(0, total - blend * (list.length - 1));
}

export function setBars(n) {
  autoDj.bars = n;
  autoDj.emit();
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function fmt(bpm) {
  if (!(bpm > 0)) return "–";
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
