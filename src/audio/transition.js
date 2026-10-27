/**
 * The transition button (step 5): one press, and the next track comes in
 * beat-matched on the bar, blends over 8, 16 or 32 bars with a bass swap
 * half way, and takes over.
 *
 * How it plays out:
 *  1. Ready: as soon as both tracks have a tempo, a stretched copy of the
 *     next track is made in the background at the playing tempo (key lock),
 *     so pressing Mix is instant. A key fix (±1/±2 semitones) is a pitch
 *     shift on top, with the stretch making up the tempo.
 *  2. On the bar: the next track starts exactly on the playing track's next
 *     bar line, on its own beat, bass cut.
 *  3. Blend: equal-power fade (overall loudness stays even). Half way, the
 *     basses swap over half a beat, so two kicks never fight, and so do the
 *     mids (where vocals live), so two voices don't talk over each other.
 *     Just before it starts, tempo and beats are re-measured in the parts
 *     about to play, and the start points snap to the real beats.
 *  4. Done: the old track stops, the crossfader moves to the new deck.
 */
import { audioContext, decks, crossfader, setCrossfader, BASS_CUT, MID_CUT } from "./engine.js";
import { stretchBuffer, localGrid } from "./analysis.js";
import { planTransition, refinePlan, blendCurves } from "../lib/transition.js";
import { tempoMatch, keyMatch, keyFixes } from "../lib/match.js";

/** What the transition is doing, for the screen. */
export const mix = {
  state: { status: "idle" }, // idle | preparing | waiting | blending | done | error
  ready: null, // { id, tempo, status: "working" | "ready" | "failed" } for the next deck's stretched copy
  listeners: new Set(),
  set(patch) {
    this.state = { ...patch };
    this.emit();
  },
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

const ACTIVE = new Set(["preparing", "waiting", "blending"]);
export const isActive = () => ACTIVE.has(mix.state.status);

/** The playing deck is "now", the other "next". Neither playing: A is now. */
export function nowAndNext() {
  const { a, b } = decks;
  return b.playing && !a.playing ? [b, a] : [a, b];
}

/**
 * What the match light compares: the now deck as the audience hears it
 * (after any earlier stretch or key shift), the next deck as it is in the file
 * (the transition will stretch it fresh).
 */
export function heard(deck) {
  const { tempo, key } = deck.analysis;
  return {
    ...deck.analysis,
    tempo: tempo && { ...tempo, bpm: deck.playingBpm },
    key: key && { ...key, camelot: deck.playingCamelot },
  };
}

/**
 * Can we mix right now, and with what settings?
 * @returns {{ ok: boolean, reason?: string, factor?: number, fix?: { semitones, code } | null, tempo?: object }}
 */
export function transitionOptions(now, next) {
  const N = now.id.toUpperCase();
  const X = next.id.toUpperCase();
  if (!now.buffer || !next.buffer) return { ok: false, reason: "Load a track on both decks." };
  if (!now.playing) return { ok: false, reason: `Play the track that's on now (${N}), then press Mix.` };
  if (next.playing) return { ok: false, reason: `Pause ${X} first: DriftMix starts it on the beat for you.` };
  if (now.analysis.status === "working" || next.analysis.status === "working")
    return { ok: false, reason: "Reading tempo and key…" };
  if (!now.analysis.tempo || !next.analysis.tempo) return { ok: false, reason: "Needs a BPM on both decks to beat-match." };
  const tempo = tempoMatch(now.playingBpm, next.analysis.tempo.bpm);
  if (tempo.level === "red") return { ok: false, reason: "Tempos are more than 6% apart: too far to blend cleanly." };
  return { ok: true, factor: tempo.factor, fix: keyFixFor(now, next), tempo };
}

/** The smallest semitone shift that makes the keys match, or null (already fine, or unknown). */
export function keyFixFor(now, next) {
  if (!now.analysis.key || !next.analysis.key) return null;
  const km = keyMatch(now.playingCamelot, next.analysis.key.camelot);
  if (km.level === "green") return null;
  return keyFixes(now.playingCamelot, next.analysis.key.camelot)[0] || null;
}

// ---- the stretched copy, made in advance -------------------------------

let prepared = null; // { source: AudioBuffer, tempo, promise }

function round(x) {
  return Math.round(x * 1e6) / 1e6;
}

/** Make (or reuse) the next track's stretched copy. Resolves to an AudioBuffer, or null when no stretch is needed. */
function prepare(next, tempo) {
  const t = round(tempo);
  if (prepared && prepared.source === next.buffer && prepared.tempo === t) return prepared.promise;
  const source = next.buffer;
  mix.ready = { id: next.id, tempo: t, status: "working" };
  mix.emit();
  const promise =
    Math.abs(t - 1) < 1e-5 ? Promise.resolve(null) : stretchBuffer(source, t, audioContext());
  prepared = { source, tempo: t, promise };
  promise.then(
    () => {
      if (prepared?.promise !== promise) return;
      mix.ready = { id: next.id, tempo: t, status: "ready" };
      mix.emit();
    },
    () => {
      if (prepared?.promise !== promise) return;
      prepared = null;
      mix.ready = { id: next.id, tempo: t, status: "failed" };
      mix.emit();
    },
  );
  return promise;
}

function settings(now, next, bars, semitones, factor, phraseBars = 1) {
  return planTransition({
    now: {
      bpm: now.analysis.tempo.bpm,
      firstBeat: now.analysis.tempo.firstBeat,
      position: now.position,
      speed: now.speed,
      duration: now.duration,
    },
    next: {
      bpm: next.analysis.tempo.bpm,
      firstBeat: next.analysis.tempo.firstBeat,
      cue: next.cue,
      duration: next.duration,
    },
    bars,
    semitones,
    factor,
    phraseBars,
  });
}

/** Local grids are only used when the beat in that stretch was clear. */
const trusted = (grid) => (grid && grid.confidence >= 0.3 ? grid : null);

/** Called by the screen whenever things change: gets the next track ready early. */
export function warmUp({ bars, useFix }) {
  if (isActive()) return;
  const [now, next] = nowAndNext();
  if (!now.buffer || !next.buffer || next.playing) return;
  if (!now.analysis.tempo || !next.analysis.tempo) return;
  const tempo = tempoMatch(now.playingBpm, next.analysis.tempo.bpm);
  if (tempo.level === "red") return;
  const fix = keyFixFor(now, next);
  const plan = settings(now, next, bars, useFix && fix ? fix.semitones : 0, tempo.factor);
  void prepare(next, plan.stretchTempo).catch(() => {});
}

// ---- running a transition ---------------------------------------------

let run = 0;
let timers = [];
let current = null; // { now, next, plan }

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

/**
 * Press Mix. `phraseBars` 8 = wait for the next 8-bar phrase line (Auto DJ);
 * 1 = the next bar (the button).
 */
export async function startTransition({ bars, useFix, phraseBars = 1 }) {
  const [now, next] = nowAndNext();
  const opts = transitionOptions(now, next);
  if (!opts.ok || isActive()) return;
  const N = now.id.toUpperCase();
  const X = next.id.toUpperCase();
  const semitones = useFix && opts.fix ? opts.fix.semitones : 0;
  const token = ++run;

  mix.set({ status: "preparing", from: now.id, to: next.id, message: `Getting ${X} ready…` });
  let stretched;
  try {
    stretched = await prepare(next, settings(now, next, bars, semitones, opts.factor).stretchTempo);
  } catch {
    if (token === run) mix.set({ status: "error", message: `Couldn't prepare ${X}. Try loading it again.` });
    return;
  }
  if (token !== run) return; // cancelled while preparing
  if (!now.playing) {
    mix.set({ status: "idle", message: `${N} stopped, so the transition didn't start.` });
    return;
  }

  // Re-measure tempo and beats in the stretches about to play, for both
  // tracks (whole-track numbers can drift a little over a long blend).
  const nb = now.analysis.tempo;
  const xb = next.analysis.tempo;
  const rough = settings(now, next, bars, semitones, opts.factor, phraseBars);
  let nowLocal = null;
  let nextLocal = null;
  try {
    [nowLocal, nextLocal] = await Promise.all([
      localGrid(now.buffer, rough.startTrack - (8 * 60) / nb.bpm, rough.startTrack + ((rough.bars * 4 + 36) * 60) / nb.bpm, nb.bpm),
      localGrid(next.buffer, rough.nextStart - (2 * 60) / xb.bpm, rough.nextStart + ((rough.bars * 4 + 4) * 60) / xb.bpm, xb.bpm),
    ]);
  } catch {
    /* fall back to the whole-track grid */
  }
  if (token !== run) return;
  if (!now.playing) {
    mix.set({ status: "idle", message: `${N} stopped, so the transition didn't start.` });
    return;
  }

  // Plan from where the playing track is *now* (it kept playing meanwhile).
  const planned = settings(now, next, bars, semitones, opts.factor, phraseBars);
  const plan = refinePlan(planned, {
    now: { bpm: nb.bpm, position: now.position, speed: now.speed },
    next: { bpm: xb.bpm },
    nowLocal: trusted(nowLocal),
    nextLocal: trusted(nextLocal),
    factor: opts.factor,
    prepared: planned.stretchTempo,
    semitones,
  });
  const ctx = audioContext();
  const when = ctx.currentTime + plan.startIn;
  const end = when + plan.blendSeconds;
  now.ensureNodes();
  next.ensureNodes();

  const heardBpm = now.playingBpm / opts.factor;
  next.setStretch({ buffer: stretched, stretchTempo: plan.stretchTempo, pitchRate: plan.pitchRate, semitones, heardBpm });
  crossfader.locked = true;
  crossfader.emit();

  const t = ctx.currentTime;
  const nowFader = now.faderNode.gain;
  const nextFader = next.faderNode.gain;
  const nowBass = now.bassNode.gain;
  const nextBass = next.bassNode.gain;
  const nowMid = now.midNode.gain;
  const nextMid = next.midNode.gain;
  const startLevel = Math.max(0.0001, nowFader.value);
  for (const p of [nowFader, nextFader, nowBass, nextBass, nowMid, nextMid]) p.cancelScheduledValues(t);
  nowFader.setValueAtTime(startLevel, t);
  nextFader.setValueAtTime(0, t);
  nowBass.setValueAtTime(0, t);
  nextBass.setValueAtTime(BASS_CUT, t);
  // Mid (vocal) swap: the incoming voice waits until half way.
  nowMid.setValueAtTime(0, t);
  nextMid.setValueAtTime(MID_CUT, t);

  const curves = blendCurves(512, startLevel);
  nowFader.setValueCurveAtTime(curves.out, when, plan.blendSeconds);
  nextFader.setValueCurveAtTime(curves.in, when, plan.blendSeconds);
  const swap = when + plan.swapAt;
  nextBass.setValueAtTime(BASS_CUT, swap);
  nextBass.linearRampToValueAtTime(0, swap + plan.swapLength);
  nowBass.setValueAtTime(0, swap);
  nowBass.linearRampToValueAtTime(BASS_CUT, swap + plan.swapLength);
  nextMid.setValueAtTime(MID_CUT, swap);
  nextMid.linearRampToValueAtTime(0, swap + plan.swapLength);
  nowMid.setValueAtTime(0, swap);
  nowMid.linearRampToValueAtTime(MID_CUT, swap + plan.swapLength);

  next.startAt(when, plan.nextStart);
  current = { now, next, plan: { ...plan, nextBpm: heardBpm }, token };

  const shift = semitones ? `, key shifted ${semitones > 0 ? "+" : ""}${semitones} semitone${Math.abs(semitones) > 1 ? "s" : ""}` : "";
  const base = { from: now.id, to: next.id, when, end, bars: plan.bars, swapAt: plan.swapAt, blendSeconds: plan.blendSeconds, nextBpm: heardBpm, semitones, refined: plan.refined };
  mix.set({ ...base, status: "waiting", message: `${X} comes in on the next ${phraseBars > 1 ? "phrase" : "bar"}…` });
  timers.push(
    setTimeout(() => token === run && mix.set({ ...base, status: "blending", message: `Blending ${N} → ${X}${shift}` }), Math.max(0, (when - ctx.currentTime) * 1000)),
  );
  timers.push(setTimeout(() => token === run && finish(), Math.max(0, (end - ctx.currentTime) * 1000) + 60));
}

function finish() {
  const { now, next, plan } = current;
  clearTimers();
  current = null;
  now.pause();
  now.resetEq();
  next.resetEq();
  crossfader.locked = false;
  setCrossfader(next.id === "b" ? 1 : -1);
  const r = Math.round(plan.nextBpm * 10) / 10;
  const bpm = Number.isInteger(r) ? r : r.toFixed(1);
  mix.set({ status: "done", from: now.id, to: next.id, message: `Done. ${next.id.toUpperCase()} is playing at ${bpm} BPM.` });
}

/** Stop a transition and put things back as they were before it. */
export function cancelTransition(reason = "Transition stopped.") {
  if (!isActive()) return;
  run++;
  clearTimers();
  if (current) {
    const { next, plan } = current;
    current = null;
    next.stop();
    next.offset = plan.nextStart;
    next.emit();
  }
  decks.a.resetEq();
  decks.b.resetEq();
  crossfader.locked = false;
  setCrossfader(crossfader.position);
  mix.set({ status: "idle", message: reason });
}

// Touching a deck (play, pause, cue, seek, load) during a transition stops it.
for (const deck of Object.values(decks)) {
  deck.touchHandlers.add(() => cancelTransition("Transition stopped: a deck was touched."));
}
