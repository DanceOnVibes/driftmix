/**
 * The transition button (step 5): one press, and the next track comes in
 * beat-matched on the bar, blends over 8, 16 or 32 bars with a bass swap
 * half way, and takes over.
 *
 * How it plays out:
 *  1. Ready: as soon as both tracks have a tempo, a stretched copy of the
 *     next track is made in the background at the playing tempo (key lock),
 *     so pressing Mix is instant. A key fix (±1/±2 semitones) is built into
 *     that copy too, so the browser never changes speed or pitch itself
 *     (its quick method adds a faint grit).
 *  2. On the bar: the next track starts exactly on the playing track's next
 *     bar line, on its own beat, bass cut.
 *  3. Blend: equal-power fade (overall loudness stays even). Half way, the
 *     basses swap over half a beat, so two kicks never fight, and so do the
 *     mids (where vocals live), so two voices don't talk over each other.
 *     Just before it starts, tempo and beats are re-measured in the parts
 *     about to play, and the start points snap to the real beats.
 *  4. Done: the old track stops, the crossfader moves to the new deck. The
 *     tiny speed trim from step 3 is then folded into a fresh copy, swapped
 *     in on the next phrase line ("polish"), so nothing plays sped up by the
 *     browser for long.
 */
import { audioContext, decks, crossfader, setCrossfader, BASS_CUT, MID_CUT, masterNode, echoControls, echoBus, onSample } from "./engine.js";
import { stretchBuffer, localGrid } from "./analysis.js";
import { planTransition, refinePlan, blendCurves } from "../lib/transition.js";
import { planBridge, settlePoint } from "../lib/bridge.js";
import { rollPattern, pickSnippet, snippetCandidates } from "../lib/buildup.js";
import { tempoMatch, keyMatch, keyFixes } from "../lib/match.js";

/** What the transition is doing, for the screen. */
export const mix = {
  state: { status: "idle" }, // idle | preparing | waiting | blending | done | error
  autoPolish: true, // after a blend, swap in a clean copy (Auto DJ does its own)
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

/**
 * Make (or reuse) the next track's copy at `tempo` (track seconds per real
 * second) with `semitones` built in. Resolves to an AudioBuffer, or null
 * when the original will do.
 */
function prepare(next, tempo, semitones = 0) {
  const t = round(tempo);
  if (prepared && prepared.source === next.buffer && prepared.tempo === t && prepared.semitones === semitones) return prepared.promise;
  const source = next.buffer;
  mix.ready = { id: next.id, tempo: t, status: "working" };
  mix.emit();
  const promise =
    Math.abs(t - 1) < 1e-5 && !semitones ? Promise.resolve(null) : stretchBuffer(source, t, audioContext(), semitones);
  prepared = { source, tempo: t, semitones, promise };
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
  const semitones = useFix && fix ? fix.semitones : 0;
  const plan = settings(now, next, bars, semitones, tempo.factor);
  void prepare(next, plan.speed, semitones).catch(() => {});
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
    stretched = await prepare(next, settings(now, next, bars, semitones, opts.factor).speed, semitones);
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
    prepared: planned.speed, // the copy already has the key shift built in
    semitones: 0,
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
  const { now, next, plan, cleanup } = current;
  clearTimers();
  current = null;
  cleanup?.();
  now.pause();
  now.resetEq();
  next.resetEq();
  crossfader.locked = false;
  setCrossfader(next.id === "b" ? 1 : -1);
  if (mix.autoPolish) void polish(next, next.speed, { heardBpm: next.heardBpm });
  const r = Math.round(plan.nextBpm * 10) / 10;
  const bpm = Number.isInteger(r) ? r : r.toFixed(1);
  mix.set({ status: "done", from: now.id, to: next.id, message: plan.nextBpm > 0 ? `Done. ${next.id.toUpperCase()} is playing at ${bpm} BPM.` : `Done. ${next.id.toUpperCase()} is playing.` });
}

/** Stop a transition and put things back as they were before it. */
export function cancelTransition(reason = "Transition stopped.") {
  if (!isActive()) return;
  run++;
  clearTimers();
  if (current) {
    const { next, plan, cleanup } = current;
    current = null;
    cleanup?.();
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

// ---- polish: no browser speed changes left playing -------------------------

const polishRun = { a: 0, b: 0 };

/**
 * Swap a playing deck to a clean copy at exactly `target` speed (track
 * seconds per real second; 1 = its own tempo), with its key shift built in,
 * on the next 8-bar phrase line at least 4 s ahead (and before `before`,
 * track seconds). After it the browser plays the copy at normal speed.
 * @returns {Promise<boolean>}  true when the swap is scheduled
 */
export async function polish(deck, target, { before = deck.duration, heardBpm = null } = {}) {
  const t = deck.analysis.tempo;
  if (!t || !deck.playing) return false;
  if (Math.abs(deck.pitchRate - 1) < 1e-6 && Math.abs(deck.speed - target) < 1e-4) return false; // already clean
  const token = ++polishRun[deck.id];
  const buffer = deck.buffer;
  const semitones = deck.semitones;
  let copy = null;
  try {
    if (Math.abs(target - 1) > 1e-5 || semitones) copy = await stretchBuffer(buffer, target, audioContext(), semitones);
  } catch {
    return false;
  }
  if (token !== polishRun[deck.id] || deck.buffer !== buffer || !deck.playing || isActive() || deck.swapPending) return false;
  const at = settlePoint({ bpm: t.bpm, firstBeat: t.firstBeat, position: deck.position, speed: deck.speed, duration: before });
  if (at === null) return false;
  const when = audioContext().currentTime + (at - deck.position) / deck.speed;
  return deck.swapAt(when, { buffer: copy, stretchTempo: copy ? target : 1, pitchRate: 1, semitones, heardBpm });
}

// ---- the echo-out bridge -------------------------------------------------

/** Can we bridge right now? (Any two tracks can: nothing has to match.) */
export function bridgeOptions(now, next) {
  if (!now.buffer || !next.buffer) return { ok: false, reason: "Load a track on both decks." };
  if (!now.playing) return { ok: false, reason: `Play the track that's on now (${now.id.toUpperCase()}) first.` };
  if (next.playing) return { ok: false, reason: `Pause ${next.id.toUpperCase()} first.` };
  return { ok: true };
}

let noise = null;
function noiseBuffer(ctx) {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    let seed = 11;
    for (let c = 0; c < 2; c++) {
      const d = noise.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = (seed / 2147483647) * 2 - 1;
      }
    }
  }
  return noise;
}

/**
 * A riser: noise through a narrow filter that sweeps up while it gets louder,
 * peaking right on the drop. Made here, from noise (no sample files).
 */
function riser(ctx, from, to, level = 0.45) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.6;
  band.frequency.setValueAtTime(400, from);
  band.frequency.exponentialRampToValueAtTime(9000, to);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, from);
  gain.gain.exponentialRampToValueAtTime(level, to - 0.03);
  gain.gain.linearRampToValueAtTime(0, to + 0.04);
  src.connect(band).connect(gain).connect(masterNode());
  src.start(from);
  src.stop(to + 0.1);
  return () => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    gain.disconnect();
  };
}

/**
 * Echo-out bridge: on the next phrase line the playing track is filtered up
 * and fed into an echo while a riser builds; two bars later it cuts, the
 * echoes ring out, and the next track drops on its own first beat.
 * @param {object} o
 * @param {number} [o.ratio]    stretch for the next track (1 = its own tempo)
 * @param {number|null} [o.heardBpm]  the tempo it will play at, for display
 * @param {string} [o.why]      shown on screen ("keys clash", …)
 */
export async function startBridge({ ratio = 1, heardBpm = null, why = "" } = {}) {
  const [now, next] = nowAndNext();
  if (!bridgeOptions(now, next).ok || isActive()) return;
  const N = now.id.toUpperCase();
  const X = next.id.toUpperCase();
  const token = ++run;
  mix.set({ status: "preparing", from: now.id, to: next.id, bridge: true, message: `Getting ${X} ready for an echo-out bridge…` });
  let stretched = null;
  if (Math.abs(ratio - 1) > 1e-4) {
    try {
      stretched = await stretchBuffer(next.buffer, ratio, audioContext());
    } catch {
      if (token === run) mix.set({ status: "error", message: `Couldn't prepare ${X}. Try loading it again.` });
      return;
    }
  }
  if (token !== run) return;
  if (!now.playing) {
    mix.set({ status: "idle", message: `${N} stopped, so the bridge didn't start.` });
    return;
  }
  const ctx = audioContext();
  const nt = now.analysis.tempo;
  const p = nt
    ? planBridge({ bpm: nt.bpm, firstBeat: nt.firstBeat, position: now.position, speed: now.speed, duration: now.duration })
    : { startIn: 0.5, dropIn: 4.5, beat: 0.5, echoBars: 2 };
  const t0 = ctx.currentTime + p.startIn;
  const t1 = ctx.currentTime + p.dropIn;
  const t2 = t1 + 8 * p.beat; // the echoes ring out over 2 more bars
  const xt = next.analysis.tempo;
  const nextStart = next.cue > 0 ? next.cue : xt ? Math.max(0, xt.firstBeat) : 0;
  const nativeBpm = xt ? xt.bpm : null;
  const playsAt = heardBpm ?? (nativeBpm ? nativeBpm * ratio : null);

  now.ensureNodes();
  next.ensureNodes();
  next.setStretch({ buffer: stretched, stretchTempo: stretched ? ratio : 1, pitchRate: 1, semitones: 0, heardBpm: stretched ? playsAt : null });
  next.resetEq();
  crossfader.locked = true;
  crossfader.emit();

  const t = ctx.currentTime;
  const nowFader = now.faderNode.gain;
  const nextFader = next.faderNode.gain;
  const startLevel = Math.max(0.0001, nowFader.value);
  for (const prm of [nowFader, nextFader, now.filterNode.frequency, now.sendNode.gain]) prm.cancelScheduledValues(t);
  nowFader.setValueAtTime(startLevel, t);
  nextFader.setValueAtTime(0, t);
  // 1. Filter sweep up and the echo send opening, over the two bars.
  const hp = now.filterNode.frequency;
  hp.setValueAtTime(10, t);
  hp.setValueAtTime(30, t0);
  hp.exponentialRampToValueAtTime(1800, t1);
  const send = now.sendNode.gain;
  send.setValueAtTime(0, t);
  send.setValueAtTime(0, t0);
  send.linearRampToValueAtTime(0.85, t0 + 4 * p.beat);
  send.setValueAtTime(0.85, t1 - 0.02);
  send.linearRampToValueAtTime(0, t1);
  const echo = echoControls();
  echo.delay.delayTime.setValueAtTime(Math.min(3.9, p.beat), t);
  echo.feedback.gain.cancelScheduledValues(t);
  echo.feedback.gain.setValueAtTime(0.55, t);
  echo.feedback.gain.setValueAtTime(0.55, t1);
  echo.feedback.gain.linearRampToValueAtTime(0.4, t1 + 4 * p.beat);
  echo.out.gain.cancelScheduledValues(t);
  echo.out.gain.setValueAtTime(1, t);
  echo.out.gain.setValueAtTime(1, t1 + 4 * p.beat);
  echo.out.gain.linearRampToValueAtTime(0, t2);
  // 2. The dry track cuts on the drop; the next one comes in full.
  nowFader.setValueAtTime(startLevel, t1 - 0.02);
  nowFader.linearRampToValueAtTime(0, t1);
  nextFader.setValueAtTime(0, t1 - 0.005);
  nextFader.linearRampToValueAtTime(1, t1 + 0.005);
  const stopRiser = riser(ctx, t0, t1);
  next.startAt(t1, nextStart);

  const cleanup = () => {
    stopRiser();
    const c = audioContext().currentTime;
    echo.out.gain.cancelScheduledValues(c);
    echo.out.gain.setValueAtTime(1, c);
    echo.feedback.gain.cancelScheduledValues(c);
    echo.feedback.gain.setValueAtTime(0.55, c);
  };
  current = { now, next, plan: { nextStart, nextBpm: playsAt ?? 0 }, token, cleanup, bridge: true };
  const base = { from: now.id, to: next.id, when: t0, end: t2, swapAt: t1 - t0, drop: t1, bridge: true, nextBpm: playsAt, why };
  mix.set({ ...base, status: "waiting", message: `Echo-out bridge on the next phrase${why ? ` (${why})` : ""}…` });
  timers.push(
    setTimeout(() => token === run && mix.set({ ...base, status: "blending", message: `Echo-out bridge ${N} → ${X}${why ? ` (${why})` : ""}` }), Math.max(0, (t0 - ctx.currentTime) * 1000)),
  );
  timers.push(setTimeout(() => token === run && finish(), Math.max(0, (t2 - ctx.currentTime) * 1000) + 60));
}

// ---- the build-up ------------------------------------------------------------

/** For the tests: the last build-up's roll channel (to listen to it alone). */
export const taps = { roll: null };

/**
 * One beat of the track (as it will play) where a voice or lead stands out,
 * from the track going out or the one coming in.
 * @returns {{ buffer: AudioBuffer, offset: number, length: number, rate: number }}
 *   offset, length: seconds in that buffer; rate: playback rate
 */
function findSnippet(deck, buffer, stretchTempo, rate, from, startTrack) {
  const t = deck.analysis.tempo;
  const list = snippetCandidates({ bpm: t.bpm, firstBeat: t.firstBeat, duration: deck.duration }, from, startTrack);
  if (!list.length) return null;
  // Track seconds → seconds in the copy that plays.
  const toBuf = (s) => s / stretchTempo;
  const sr = buffer.sampleRate;
  const lo = Math.max(0, Math.floor(toBuf(list[0].start) * sr));
  const hi = Math.min(buffer.length, Math.ceil(toBuf(list[list.length - 1].start + list[list.length - 1].length) * sr));
  if (hi - lo < 64) return null;
  const mono = new Float32Array(hi - lo);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += d[lo + i] / buffer.numberOfChannels;
  }
  const best = list[pickSnippet(mono, sr, list.map((c) => ({ start: toBuf(c.start) - lo / sr, length: toBuf(c.length) })))];
  return { buffer, offset: toBuf(best.start), length: toBuf(best.length), rate };
}

/**
 * Build-up: on the next phrase line a one-beat snippet starts repeating in
 * time, faster and faster (2 beats, 1, ½, ¼, ⅛) while a riser climbs and the
 * playing track thins out. One beat of silence, then the next track drops on
 * its first beat, with the snippet's last repeats echoing over it.
 * Needs tempos that can match (like Mix): the drop lands on the beat.
 * @param {object} o
 * @param {4|8} [o.bars]       length of the build-up
 * @param {"incoming"|"outgoing"} [o.from]  where the snippet comes from
 * @param {boolean} [o.useFix] key fix for the next track (as Mix)
 * @param {number} [o.phraseBars]  start on the next 8-bar phrase (or 1 = next bar)
 */
export async function startBuildUp({ bars = 8, from = "incoming", useFix = true, phraseBars = 8 } = {}) {
  const [now, next] = nowAndNext();
  const opts = transitionOptions(now, next);
  if (!opts.ok || isActive()) return;
  const N = now.id.toUpperCase();
  const X = next.id.toUpperCase();
  const semitones = useFix && opts.fix ? opts.fix.semitones : 0;
  const token = ++run;
  mix.set({ status: "preparing", from: now.id, to: next.id, buildUp: true, message: `Getting ${X} ready for a build-up…` });
  const speed = settings(now, next, bars, semitones, opts.factor).speed;
  let stretched;
  try {
    stretched = await prepare(next, speed, semitones);
  } catch {
    if (token === run) mix.set({ status: "error", message: `Couldn't prepare ${X}. Try loading it again.` });
    return;
  }
  if (token !== run) return;
  if (!now.playing) {
    mix.set({ status: "idle", message: `${N} stopped, so the build-up didn't start.` });
    return;
  }

  const ctx = audioContext();
  const nt = now.analysis.tempo;
  const xt = next.analysis.tempo;
  const p = planBridge({ bpm: nt.bpm, firstBeat: nt.firstBeat, position: now.position, speed: now.speed, duration: now.duration }, { lead: 0.6, echoBars: bars, phraseBars });
  const beat = p.beat;
  const t0 = ctx.currentTime + p.startIn;
  const t1 = ctx.currentTime + p.dropIn; // the drop
  const t2 = t1 + 8 * beat; // echoes ring out
  const half = t0 + (t1 - t0) / 2;

  // The snippet: one beat, from the copy each track will play.
  const snip =
    from === "outgoing"
      ? findSnippet(now, now.stretched || now.buffer, now.stretched ? now.stretchTempo : 1, now.pitchRate, "outgoing", p.startTrack)
      : findSnippet(next, stretched || next.buffer, stretched ? speed : 1, 1, "incoming", 0);
  const heardBpm = now.playingBpm / opts.factor;
  const nextStart = next.cue > 0 ? next.cue : Math.max(0, xt.firstBeat);

  now.ensureNodes();
  next.ensureNodes();
  next.setStretch({ buffer: stretched, stretchTempo: stretched ? speed : 1, pitchRate: 1, semitones, heardBpm });
  next.resetEq();
  crossfader.locked = true;
  crossfader.emit();

  const t = ctx.currentTime;
  const nowFader = now.faderNode.gain;
  const nextFader = next.faderNode.gain;
  const startLevel = Math.max(0.0001, nowFader.value);
  for (const prm of [nowFader, nextFader, now.filterNode.frequency, now.bassNode.gain, now.sendNode.gain]) prm.cancelScheduledValues(t);
  nowFader.setValueAtTime(startLevel, t);
  nextFader.setValueAtTime(0, t);
  // The playing track thins out (filter up, bass out in the second half),
  // gets quieter under the roll, and stops for the last beat.
  const hp = now.filterNode.frequency;
  hp.setValueAtTime(10, t);
  hp.setValueAtTime(30, t0);
  hp.exponentialRampToValueAtTime(600, t1 - beat);
  const bass = now.bassNode.gain;
  bass.setValueAtTime(0, half);
  bass.linearRampToValueAtTime(BASS_CUT, half + 4 * beat);
  nowFader.setValueAtTime(startLevel, t0);
  nowFader.linearRampToValueAtTime(startLevel * 0.7, half);
  nowFader.linearRampToValueAtTime(startLevel * 0.4, t1 - beat - 0.02);
  nowFader.linearRampToValueAtTime(0, t1 - beat);
  // The next track drops in full on its first beat.
  nextFader.setValueAtTime(0, t1 - 0.005);
  nextFader.linearRampToValueAtTime(1, t1 + 0.005);

  // The roll: its own little channel (kick and bass filtered out) into the
  // master, and into the echo for the last repeats.
  const bus = ctx.createGain();
  const busHp = ctx.createBiquadFilter();
  busHp.type = "highpass";
  busHp.Q.value = 0.7;
  const busSend = ctx.createGain();
  taps.roll = busHp;
  bus.connect(busHp);
  busHp.connect(masterNode());
  busHp.connect(busSend);
  busSend.connect(echoBus(ctx));
  bus.gain.setValueAtTime(0.8, t0);
  bus.gain.linearRampToValueAtTime(0.95, t1 - beat);
  // Incoming: starts thin and fills out (it's arriving); outgoing: stays thin.
  busHp.frequency.setValueAtTime(from === "outgoing" ? 300 : 600, t0);
  busHp.frequency.exponentialRampToValueAtTime(from === "outgoing" ? 400 : 220, t1 - beat);
  busSend.gain.setValueAtTime(0, t);
  busSend.gain.setValueAtTime(0, t1 - 3 * beat);
  busSend.gain.linearRampToValueAtTime(0.8, t1 - beat);
  busSend.gain.setValueAtTime(0.8, t1);
  busSend.gain.linearRampToValueAtTime(0, t1 + beat);
  const echo = echoControls();
  echo.delay.delayTime.setValueAtTime(Math.min(3.9, 0.75 * beat), t);
  echo.feedback.gain.cancelScheduledValues(t);
  echo.feedback.gain.setValueAtTime(0.5, t);
  echo.out.gain.cancelScheduledValues(t);
  echo.out.gain.setValueAtTime(1, t);
  echo.out.gain.setValueAtTime(1, t1 + 2 * beat);
  echo.out.gain.linearRampToValueAtTime(0, t2);

  const sources = [];
  if (snip) {
    const sr = ctx.sampleRate;
    const realLength = snip.length / snip.rate;
    for (const hit of rollPattern(bars)) {
      const when = onSample(t0 + hit.at * beat, sr);
      // Fast repeats are gated a little shorter, so each one is heard as a
      // new hit even when the snippet is a held chord or a long note.
      const dur = Math.min(hit.length * beat * (hit.length <= 0.25 ? 0.6 : hit.length <= 0.5 ? 0.85 : 1), realLength);
      const src = ctx.createBufferSource();
      src.buffer = snip.buffer;
      src.playbackRate.value = snip.rate;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + 0.003);
      g.gain.setValueAtTime(1, when + dur - 0.006);
      g.gain.linearRampToValueAtTime(0, when + dur);
      src.connect(g).connect(bus);
      src.start(when, onSample(snip.offset, snip.buffer.sampleRate), dur * snip.rate + 0.01);
      sources.push(src);
    }
  }
  // The riser peaks as the roll stops, so the last beat is a breath (only
  // echoes) before the drop.
  const stopRiser = riser(ctx, half, t1 - beat, 0.3);
  next.startAt(t1, nextStart);

  const cleanup = () => {
    stopRiser();
    for (const src of sources) {
      try {
        src.stop();
      } catch {
        /* already done */
      }
    }
    bus.disconnect();
    busSend.disconnect();
    const c = audioContext().currentTime;
    echo.out.gain.cancelScheduledValues(c);
    echo.out.gain.setValueAtTime(1, c);
    echo.feedback.gain.cancelScheduledValues(c);
    echo.feedback.gain.setValueAtTime(0.55, c);
  };
  // Leave the last echoes ringing when it finishes normally: only stop
  // what hasn't played yet (nothing, by then) and free the channel later.
  current = { now, next, plan: { nextStart, nextBpm: heardBpm }, token, cleanup, buildUp: true };
  const what = snip ? (from === "outgoing" ? `${N}'s last words roll out` : `a taste of ${X} rolls in`) : "a riser builds";
  const shift = semitones ? `, key shifted ${semitones > 0 ? "+" : ""}${semitones}` : "";
  const base = { from: now.id, to: next.id, when: t0, end: t2, swapAt: t1 - t0, drop: t1, buildUp: true, nextBpm: heardBpm, snippetFrom: snip ? from : null, semitones };
  mix.set({ ...base, status: "waiting", message: `Build-up on the next phrase: ${what}, then ${X} drops${shift}…` });
  timers.push(
    setTimeout(() => token === run && mix.set({ ...base, status: "blending", message: `Build-up ${N} → ${X}: ${what}${shift}` }), Math.max(0, (t0 - ctx.currentTime) * 1000)),
  );
  timers.push(setTimeout(() => token === run && finish(), Math.max(0, (t2 - ctx.currentTime) * 1000) + 60));
}

// Touching a deck (play, pause, cue, seek, load) during a transition stops it.
for (const deck of Object.values(decks)) {
  deck.touchHandlers.add(() => cancelTransition("Transition stopped: a deck was touched."));
}
