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
 *  - Bridges: with clips in the Bridges list, a short beat-only clip plays
 *    between tracks (every mix, or only where the keys clash): A blends into
 *    the clip, the clip carries the beat, B blends in (see bridges.js).
 *  - Touching a deck hands control back to you (Auto DJ switches off).
 */
import { tidyName } from "../lib/files/naming.js";
import { audioContext, decks, setCrossfader } from "./engine.js";
import { analyzeBuffer, stretchBuffer } from "./analysis.js";
import { mix, isActive, nowAndNext, transitionOptions, startTransition, cancelTransition, startBridge, startBuildUp, polish } from "./transition.js";
import { orderSet, orderTracks, fitsTempo, mixOutIn, mixOutPoint, ORDER_BY } from "../lib/setlist.js";
import { chooseMix, settlePoint } from "../lib/bridge.js";
import { tempoMatch, TEMPO_AMBER } from "../lib/match.js";
import { retunedReading } from "../lib/files/retune.js";
import { offerUndo } from "./files.js";
import { bridges, makeBridge, readyClips } from "./bridges.js";
import { bridgeDue, BRIDGE_BLEND_BARS } from "../lib/bridgeClip.js";

const AUDIO_NAME = /\.(mp3|wav|flac|aiff?|m4a|aac|ogg|opus)$/i;

export const autoDj = {
  /**
   * tempo, key, duration: as the track will play (with any exact BPM and key
   * shift from Files built in); found, sourceDuration: as the file reads.
   * @type {{ id: string, file: File, name: string, status: "reading"|"ready"|"failed", tempo: object|null, key: object|null, duration: number, found: object|null, sourceDuration: number, plan: { tempo: number, semitones: number } }[]}
   */
  tracks: [],
  on: false,
  bars: 16,
  tempoChoice: "first", // "first" = the first track's tempo, "journey" = each its own, or a number (128 …)
  setBpm: null, // the set's locked tempo while running (null on a journey)
  bridge: true, // echo-out bridge when tracks can't blend (off = skip them)
  buildUps: "off", // "off" | "third" (every third mix) | "every": a build-up instead of a blend
  orderBy: "keys", // what "Order" puts first: "keys" | "tempo-up" | "tempo-down"
  mixes: 0, // mixes made in this set (for "every third")
  onDeck: { a: null, b: null }, // which playlist track is on each deck
  message: "",
  undo: null, // the playlist just cleared, for 10 seconds
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
/** Bridges on a deck: their id ("bridge:…") → { after: the track they follow, name }. */
const bridgeInfo = new Map();
let bridgeCount = 0;

/** Is this deck's "track" a bridge clip? */
export const isBridgeId = (id) => typeof id === "string" && id.startsWith("bridge:");

/** The name of whatever is on a deck (a playlist track or a bridge). */
export function nameOfId(id) {
  if (isBridgeId(id)) return bridgeInfo.get(id)?.name ?? "Bridge";
  return autoDj.tracks.find((t) => t.id === id)?.name ?? "";
}
let timer = null;
let busy = false; // Auto DJ is loading or starting something itself

// ---- the playlist ------------------------------------------------------

const NO_PLAN = { tempo: 1, semitones: 0 };
const planned = (plan) => Boolean(plan) && (plan.tempo !== 1 || plan.semitones !== 0);

/**
 * Add tracks to the playlist.
 * @param {Iterable<File | { file: File, name: string, plan?: object, found?: object|null, duration?: number }>} fileList
 *   files, or (from Files) files with a title, the exact BPM and key shift
 *   set there, and the reading Files already made
 * @returns {{ added: number, updated: number }} updated: already there, brought up to date (sent from Files again)
 */
export function addTracks(fileList) {
  const entries = [...fileList].map((f) => (f instanceof Blob ? { file: f, name: tidyName(f.name) } : f));
  let added = 0;
  let updated = 0;
  for (const entry of entries) {
    const { file } = entry;
    if (!(file.type.startsWith("audio/") || AUDIO_NAME.test(file.name))) continue;
    // Each file once: sending from Files again brings the title, BPM and key
    // up to date instead of doubling up (not for the two tracks on the decks).
    const had = autoDj.tracks.find((t) => t.file === file);
    if (had) {
      if (isLive(had.id) || !entry.plan) continue;
      had.name = entry.name ?? had.name;
      had.plan = entry.plan;
      if (!had.found && entry.found) {
        had.found = entry.found;
        had.sourceDuration = entry.duration || had.sourceDuration;
      }
      if (had.found) applyPlan(had);
      updated++;
      continue;
    }
    const track = {
      id: String(nextId++),
      file,
      name: entry.name ?? tidyName(file.name),
      status: "reading",
      tempo: null,
      key: null,
      duration: 0,
      found: entry.found ?? null,
      sourceDuration: entry.duration || 0,
      plan: entry.plan ?? NO_PLAN,
    };
    autoDj.tracks.push(track);
    added++;
    // Already read in Files: ready straight away. Otherwise read it here.
    if (track.found && track.sourceDuration) applyPlan(track);
    else reading = reading.then(() => readTrack(track));
  }
  autoDj.emit();
  return { added, updated };
}

/** Tempo, key and length as the track will play, from the reading and the plan. */
function applyPlan(track) {
  const r = retunedReading(track.found, track.plan);
  track.tempo = r.tempo;
  track.key = r.key;
  track.duration = track.sourceDuration / (track.plan.tempo || 1);
  track.status = "ready";
}

async function readTrack(track) {
  if (!autoDj.tracks.includes(track)) return;
  try {
    const buffer = await audioContext().decodeAudioData(await track.file.arrayBuffer());
    track.sourceDuration = buffer.duration;
    const result = await analyzeBuffer(buffer);
    track.found = { tempo: result.tempo ?? null, key: result.key ?? null };
    applyPlan(track);
  } catch {
    track.status = "failed";
  }
  autoDj.emit();
}

/**
 * Put back a playlist kept on this device (see keep.js), in front of
 * anything added meanwhile, with the settings it had.
 * @param {{ tracks: { file: File, name: string, plan: object, found: object|null, duration: number }[], settings?: object }} saved
 */
export function restoreTracks({ tracks, settings }) {
  const added = [];
  for (const s of tracks) {
    if (autoDj.tracks.some((t) => t.file === s.file)) continue;
    const track = { id: String(nextId++), file: s.file, name: tidyName(s.name), status: "reading", tempo: null, key: null, duration: 0, found: s.found ?? null, sourceDuration: s.duration || 0, plan: s.plan ?? NO_PLAN };
    if (track.found && track.sourceDuration) applyPlan(track);
    else reading = reading.then(() => readTrack(track));
    added.push(track);
  }
  autoDj.tracks = [...added, ...autoDj.tracks];
  if (settings && !autoDj.on) {
    if (settings.tempoChoice !== undefined) autoDj.tempoChoice = settings.tempoChoice;
    if (BAR_OK(settings.bars)) autoDj.bars = settings.bars;
    if (typeof settings.bridge === "boolean") autoDj.bridge = settings.bridge;
    if (["off", "third", "every"].includes(settings.buildUps)) autoDj.buildUps = settings.buildUps;
    if (ORDER_BY[settings.orderBy]) autoDj.orderBy = settings.orderBy;
  }
  autoDj.emit();
  return added.length;
}

const BAR_OK = (n) => Number.isInteger(n) && n > 0 && n <= 64;

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
  const was = autoDj.tracks;
  autoDj.tracks = [];
  autoDj.message = "";
  offerUndo(autoDj, { tracks: was }, `Cleared the playlist (${was.length} track${was.length === 1 ? "" : "s"}).`);
  autoDj.emit();
}

/** Bring back the playlist that was just cleared (within 10 seconds). */
export function undoClear() {
  const u = autoDj.undo;
  if (!u || autoDj.on) return;
  if (u.order) {
    // Undo an Order: the tracks go back where they were (new ones stay at the end).
    const rank = new Map(u.order.map((id, i) => [id, i]));
    autoDj.tracks = [...autoDj.tracks].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    autoDj.message = "Back to the order you had.";
  } else {
    const back = u.tracks.filter((t) => !autoDj.tracks.some((x) => x.file === t.file));
    autoDj.tracks = [...back, ...autoDj.tracks];
  }
  autoDj.undo = null;
  autoDj.emit();
}

export function setOrderBy(value) {
  if (!ORDER_BY[value]) return;
  autoDj.orderBy = value;
  autoDj.emit();
}

/**
 * "Order for a smooth set", by what the DJ picked: tempo first (slow → fast
 * or fast → slow, keys smoothed where tempos are within 1 BPM), or flowing
 * keys (first fitting track stays first). Undo puts the old order back.
 */
export function sortSet() {
  if (autoDj.on) return;
  const before = autoDj.tracks.map((t) => t.id);
  const ready = autoDj.tracks.filter((t) => t.status === "ready");
  const others = autoDj.tracks.filter((t) => t.status !== "ready");
  const byId = new Map(ready.map((t) => [t.id, t]));
  const plain = ready.map((t) => ({ id: t.id, bpm: t.tempo?.bpm ?? null, camelot: t.key?.camelot ?? null }));
  const offer = () => {
    if (autoDj.tracks.some((t, i) => t.id !== before[i])) offerUndo(autoDj, { order: before }, "Put in a new order.");
  };
  if (autoDj.orderBy !== "keys" || autoDj.tempoChoice === "journey") {
    // Tempo first, or keys with every track at its own tempo (a journey).
    const j = orderTracks(plain, autoDj.orderBy);
    autoDj.tracks = [...j.order.map((o) => byId.get(o.id)), ...j.left.map((o) => byId.get(o.id)), ...others];
    const first = j.order[0];
    const last = j.order[j.order.length - 1];
    const noBeat = j.left.length ? ` No beat found in ${j.left.length}: moved to the end.` : "";
    autoDj.message =
      j.order.length < 2
        ? ""
        : autoDj.orderBy === "keys"
          ? `Ordered for flowing keys, each track at its own tempo.${noBeat}`
          : `Ordered by tempo: ${fmt(first.bpm)} → ${fmt(last.bpm)} BPM, keys smoothed where tempos are within 1 BPM.${noBeat}`;
    offer();
    autoDj.emit();
    return;
  }
  const chosen = autoDj.tempoChoice === "first" ? null : Number(autoDj.tempoChoice);
  const { order, left, setBpm } = orderSet(
    ready.map((t) => ({ id: t.id, bpm: t.tempo?.bpm ?? null, camelot: t.key?.camelot ?? null })),
    chosen,
  );
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
  offer();
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

export function setBuildUps(value) {
  autoDj.buildUps = ["off", "third", "every"].includes(value) ? value : "off";
  autoDj.emit();
}

/** Is the next mix a build-up? (Every third: mixes 3, 6, 9…) */
const buildUpDue = () => autoDj.buildUps === "every" || (autoDj.buildUps === "third" && autoDj.mixes % 3 === 2);

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
    // An exact BPM or key shift from Files is built into the audio as it
    // loads (the same clean process as Convert), so the deck plays the track
    // exactly as set, and no later step has to change its speed or key.
    await deck.load(track.file, { known: { tempo: track.tempo, key: track.key }, byApp: true, retune: planned(track.plan) ? track.plan : null });
    autoDj.onDeck[deck.id] = track.id;
  } finally {
    busy = false;
  }
}

/**
 * Load the track after `afterId` onto `deck`, skipping ones that can't join,
 * or a bridge clip first when one is due between the two.
 */
async function queueAfter(afterId, deck) {
  const after = isBridgeId(afterId) ? bridgeInfo.get(afterId)?.after ?? null : afterId;
  const { track, skipped } = nextPlayable(after);
  if (skipped.length) autoDj.message = `Skipped ${skipped.map((t) => `${t.name} (${skipReason(t)})`).join("; ")}.`;
  if (!track) {
    autoDj.onDeck[deck.id] = null;
    autoDj.emit();
    return null;
  }
  const from = autoDj.tracks.find((t) => t.id === afterId);
  if (from && readyClips().length && bridgeDue(bridges.mode, from.key?.camelot ?? null, track.key?.camelot ?? null)) {
    const bridge = await loadBridge(deck, from).catch(() => null);
    if (bridge) {
      autoDj.emit();
      return bridge;
    }
  }
  await loadOnto(deck, track);
  autoDj.emit();
  return track;
}

/** A bridge clip, looped to length, onto `deck` (after the track `from`). */
async function loadBridge(deck, from) {
  busy = true;
  try {
    const b = await makeBridge();
    if (!b) return null;
    await deck.load(b.file, { known: { tempo: b.tempo, key: null }, byApp: true });
    const id = `bridge:${++bridgeCount}`;
    bridgeInfo.set(id, { after: from.id, name: b.name });
    autoDj.onDeck[deck.id] = id;
    return { id, name: b.name };
  } finally {
    busy = false;
  }
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
  mix.autoPolish = false; // Auto DJ settles or polishes each track itself
  autoDj.onDeck = { a: null, b: null };
  autoDj.mixes = 0;
  bridges.used = 0;
  bridgeInfo.clear();
  const intro = setBpm ? `Set tempo ${fmt(setBpm)} BPM.` : "Tempo journey: every track settles to its own tempo after its blend.";
  autoDj.message = intro;
  autoDj.emit();

  if (planned(first.plan)) {
    autoDj.message = `Getting ${first.name} ready: exact BPM and key from Files…`;
    autoDj.emit();
  }
  await loadOnto(decks.a, first);
  if (!autoDj.on) return;
  autoDj.message = intro;
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
  mix.autoPolish = true;
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
  if (now.swapPending) return; // settling to its own tempo right now: wait for it
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
  // Into or out of a bridge clip: a short blend, no build-up.
  const viaClip = isBridgeId(autoDj.onDeck[now.id]) || isBridgeId(autoDj.onDeck[next.id]);
  const buildUp = choice.kind === "blend" && !viaClip && buildUpDue();
  const bars = choice.kind === "bridge" ? 3 : viaClip ? BRIDGE_BLEND_BARS : buildUp ? 8 : unsure ? Math.min(8, autoDj.bars) : autoDj.bars;
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
  const nextName = nameOfId(autoDj.onDeck[next.id]) || "the next track";
  if (choice.kind === "bridge") {
    autoDj.message = `${nextName}: echo-out bridge (${choice.why}).`;
    autoDj.emit();
    void startBridge({ ratio, heardBpm: choice.targetBpm, why: choice.why });
    return;
  }
  const opts = transitionOptions(now, next);
  if (buildUp && opts.ok) {
    // The snippet takes turns: a taste of the next track, then the last words of the one going out.
    const from = Math.floor(autoDj.mixes / (autoDj.buildUps === "every" ? 1 : 3)) % 2 === 0 ? "incoming" : "outgoing";
    autoDj.mixes++;
    autoDj.message = `${nextName}: build-up (${from === "incoming" ? "a taste of it rolls in" : "the last words roll out"}).`;
    autoDj.emit();
    void startBuildUp({ bars: 8, from, useFix: true, phraseBars: point !== null && point > now.position ? 8 : 1 });
    return;
  }
  if (choice.kind === "blend" && opts.ok) {
    autoDj.mixes++;
    if (isBridgeId(autoDj.onDeck[next.id])) {
      autoDj.message = `Bridge: ${nextName} carries the beat into the next track.`;
      autoDj.emit();
    } else if (bars < autoDj.bars && !viaClip) {
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

// ---- after each blend: settle (journey) or polish (locked) ----------------

/**
 * After a blend the new track plays a prepared copy with a tiny speed trim.
 * On the next phrase line (well before its own mix-out) it swaps to a clean
 * copy: on a journey at its own tempo (it "settles"); with a locked tempo at
 * exactly the set tempo. Key shifts stay built in either way.
 */
async function afterBlend(deck) {
  if (!autoDj.on) return;
  const t = deck.analysis.tempo;
  if (!t) return;
  const mixOut = mixOutPoint({ firstBeat: t.firstBeat, bpm: t.bpm, duration: deck.duration, bars: autoDj.bars }) ?? deck.duration;
  const from = deck.playingBpm;
  const ok = journey()
    ? await polish(deck, 1, { before: mixOut, heardBpm: null })
    : await polish(deck, deck.speed, { before: mixOut, heardBpm: deck.heardBpm });
  if (!ok || !journey() || Math.abs(from - t.bpm) < 0.05) return;
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
  if (!isBridgeId(playingTrack)) void afterBlend(decks[mix.state.to]);
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
