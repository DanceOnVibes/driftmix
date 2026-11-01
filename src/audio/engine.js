/**
 * The audio engine: two decks and a crossfader, built on the browser's own
 * Web Audio. Tracks are read from the DJ's computer and stay there.
 *
 * Signal path for each deck:
 *   track → deck volume → filter → bass EQ → mid EQ → crossfader gain → master → speakers
 *                                                          └→ echo send (the echo-out bridge)
 *
 * The bass and mid EQs are what the transition button uses for the bass swap
 * and the vocal (mid) swap; the filter (a high-pass, normally wide open) and
 * the echo send are for the echo-out bridge.
 *
 * Browsers only allow sound to start after the person clicks something, so the
 * audio context is created (or woken up) on the first click.
 *
 * Positions ("offset", "position", "cue") are always in track seconds: where
 * you are in the original file. After a transition a deck may play a
 * stretched copy at another tempo; `speed` converts between the two.
 */
import { tidyName } from "../lib/files/naming.js";
import { EQ_BANDS, eqGainDb, filterHz, echoSeconds, reverbImpulse } from "../lib/djmixer.js";
import { computePeaks } from "../lib/peaks.js";
import { crossfadeGains, clamp, pressCue } from "../lib/mixer.js";
import { shiftCamelot } from "../lib/match.js";
import { analyzeBuffer, stretchBuffer } from "./analysis.js";
import { HOT_CUES, quantize, jumpTarget, loopAt, resizeLoop, wrapPosition, cueKey } from "../lib/cues.js";

const CUES_SAVED = "driftmix.cues.v1";
const JUMP_LEAD = 0.01; // seconds: a jump is scheduled this far ahead, so it can cross-fade
/** Hot cues kept on this device, per track. */
function savedCues(key) {
  try {
    const all = JSON.parse(localStorage.getItem(CUES_SAVED) || "{}");
    const c = all[key];
    return Array.isArray(c) ? Array.from({ length: HOT_CUES }, (_, i) => (typeof c[i] === "number" ? c[i] : null)) : Array(HOT_CUES).fill(null);
  } catch {
    return Array(HOT_CUES).fill(null);
  }
}
function saveCues(key, cues) {
  try {
    const all = JSON.parse(localStorage.getItem(CUES_SAVED) || "{}");
    delete all[key];
    if (cues.some((c) => c !== null)) all[key] = cues;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete all[k]; // keep the newest 500 tracks
    localStorage.setItem(CUES_SAVED, JSON.stringify(all));
  } catch {
    /* not kept: fine */
  }
}

/** Smooth volume changes over ~15 ms so faders never click. */
const SMOOTH = 0.015;
export const WAVEFORM_BARS = 1200;
/** Bass EQ: the low shelf sits at 180 Hz; "cut" is −30 dB. */
export const BASS_HZ = 180;
export const BASS_CUT = -30;
/**
 * Mid EQ: a wide dip around 1.2 kHz (roughly 400 Hz – 3.5 kHz), where vocals
 * live. "Cut" is −18 dB: the incoming track's voice stays out of the way
 * until the swap, while its hats and groove come through as a hint.
 */
export const MID_HZ = 1200;
export const MID_Q = 0.6;
export const MID_CUT = -18;

let context = null;
let limiter = null;
let masterOut = null;
let reverb = null;
/** Undoes the small level lift the browser's compressor adds, so quiet music comes out exactly as it went in. */
const LIMITER_TRIM = 10 ** (-0.855 / 20); // measured: the compressor lifts everything by 0.855 dB
let master = null;

/**
 * A time (or buffer position) moved to the nearest whole sample. Chrome plays
 * a sound that starts between two samples through its quick in-between
 * method for the whole track (a faint grit, about −40 dB); starting on a
 * whole sample plays the samples exactly. The shift is at most 0.01 ms.
 */
export function onSample(seconds, sampleRate) {
  return Math.round(seconds * sampleRate) / sampleRate;
}

/** What reaches the speakers (after the limiter): what a recorded set should capture. */
export function masterOutput() {
  audioContext();
  return masterOut;
}

/** The master bus (everything the decks play), before the limiter. */
export function masterNode() {
  audioContext();
  return master;
}

export function audioContext() {
  if (!context) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    context = new Ctx();
    master = context.createGain();
    // A safety limiter on everything: boosted EQs on both decks never clip
    // the speakers or a recorded set. Quiet music passes untouched.
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    masterOut = context.createGain();
    masterOut.gain.value = LIMITER_TRIM;
    master.connect(limiter).connect(masterOut).connect(context.destination);
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

export class Deck {
  constructor(id) {
    this.id = id;
    this.buffer = null;
    this.name = "";
    this.peaks = null;
    /**
     * Tempo and key: { status: "none" | "working" | "done" | "failed",
     *                  tempo: { bpm, firstBeat, sure } | null,
     *                  key: { camelot, name, sure } | null }
     */
    this.analysis = { status: "none", tempo: null, key: null };
    this.source = null;
    this.sourceGain = null;
    this.before = null; // the previous speed mapping, until a scheduled swap happens
    this.playing = false;
    this.offset = 0; // where in the track we are while paused (track seconds)
    this.playFrom = 0; // track seconds where the current playback began
    this.playStart = 0; // context time when it began (may be in the future)
    this.cue = 0;
    this.hotCues = Array(HOT_CUES).fill(null); // track seconds, on the beat
    this.cueKey = "";
    this.loop = null; // { start, end, beats } in track seconds, while a loop plays
    this.listeners = new Set();
    this.loadTicket = 0;
    this.volume = 1;
    this.fader = 1;
    this.volumeNode = null;
    this.bassNode = null;
    this.midNode = null;
    this.faderNode = null;
    this.filterNode = null;
    this.sendNode = null;
    // The DJ's own knobs (separate from what the transitions automate).
    this.eq = { low: 0, mid: 0, high: 0 }; // −1 … +1
    this.kills = { low: false, mid: false, high: false };
    this.filter = 0; // −1 low-pass … +1 high-pass
    this.echo = 0; // 0 … 1
    this.verb = 0; // 0 … 1
    this.knobs = null;
    this.clearStretch();
    /** Called when the DJ presses something on this deck (the transition and Auto DJ listen). */
    this.touchHandlers = new Set();
  }

  /** Back to the original track: normal tempo, normal key. */
  clearStretch() {
    this.stretched = null; // AudioBuffer of the stretched copy, or null
    this.stretchTempo = 1; // track seconds per stretched-copy second
    this.pitchRate = 1; // playback rate (the key shift)
    this.semitones = 0;
    this.heardBpm = null; // the tempo it's been matched to, for display
  }

  /** Track seconds per real second (1 = original tempo). */
  get speed() {
    return this.stretchTempo * this.pitchRate;
  }

  /** The tempo and key the audience hears right now. */
  get playingBpm() {
    const t = this.analysis.tempo;
    if (!t) return null;
    // After a mix the deck plays at the tempo it was matched to. (The exact
    // speed also carries a tiny correction from the fresh beat measurement,
    // which would otherwise show as 132.98 instead of 133.)
    return this.heardBpm ?? t.bpm * this.speed;
  }

  get playingCamelot() {
    const k = this.analysis.key;
    return k ? shiftCamelot(k.camelot, this.semitones) : null;
  }

  ensureNodes() {
    const ctx = audioContext();
    if (!this.volumeNode) {
      this.volumeNode = ctx.createGain();
      this.bassNode = ctx.createBiquadFilter();
      this.bassNode.type = "lowshelf";
      this.bassNode.frequency.value = BASS_HZ;
      this.bassNode.gain.value = 0;
      this.midNode = ctx.createBiquadFilter();
      this.midNode.type = "peaking";
      this.midNode.frequency.value = MID_HZ;
      this.midNode.Q.value = MID_Q;
      this.midNode.gain.value = 0;
      this.faderNode = ctx.createGain();
      this.filterNode = ctx.createBiquadFilter();
      this.filterNode.type = "highpass";
      this.filterNode.frequency.value = 10; // wide open
      this.filterNode.Q.value = 0.7;
      this.sendNode = ctx.createGain();
      this.sendNode.gain.value = 0;
      // The DJ's knobs come first: filter, then LOW / MID / HIGH.
      const k = {};
      k.hp = ctx.createBiquadFilter();
      k.hp.type = "highpass";
      k.lp = ctx.createBiquadFilter();
      k.lp.type = "lowpass";
      for (const f of [k.hp, k.lp]) f.Q.value = 1.1; // a touch of resonance, like a DJ filter
      for (const [band, spec] of Object.entries(EQ_BANDS)) {
        const node = ctx.createBiquadFilter();
        node.type = spec.type;
        node.frequency.value = spec.hz;
        if (spec.q) node.Q.value = spec.q;
        k[band] = node;
      }
      // Effects, after the crossfader (so they follow the mix): echo timed to this deck's beat, and reverb.
      k.echoSend = ctx.createGain();
      k.echoDelay = ctx.createDelay(3);
      k.echoFeedback = ctx.createGain();
      k.echoFeedback.gain.value = 0.42;
      k.echoTone = ctx.createBiquadFilter();
      k.echoTone.type = "bandpass";
      k.echoTone.frequency.value = 1400;
      k.echoTone.Q.value = 0.5;
      k.echoSend.connect(k.echoDelay).connect(k.echoTone);
      k.echoTone.connect(k.echoFeedback).connect(k.echoDelay);
      k.echoTone.connect(master);
      k.verbSend = ctx.createGain();
      k.verbSend.connect(reverbBus(ctx));
      this.knobs = k;
      this.volumeNode.connect(k.hp).connect(k.lp).connect(k.low).connect(k.mid).connect(k.high).connect(this.filterNode);
      this.faderNode.connect(k.echoSend);
      this.faderNode.connect(k.verbSend);
      this.applyKnobs(true);
      this.filterNode.connect(this.bassNode);
      this.bassNode.connect(this.midNode);
      this.midNode.connect(this.faderNode);
      this.faderNode.connect(master);
      this.faderNode.connect(this.sendNode);
      this.sendNode.connect(echoBus(ctx));
      this.volumeNode.gain.value = this.volume;
      this.faderNode.gain.value = this.fader;
    }
    return ctx;
  }

  /** The DJ pressed something on this deck. */
  touched() {
    for (const handler of this.touchHandlers) handler(this);
  }

  /**
   * Read a file from the computer and get it ready to play.
   * Options (used by Auto DJ): `known` = tempo and key already read, so they
   * aren't read again; `byApp` = DriftMix is loading it, not the DJ.
   */
  /**
   * @param {File} file
   * @param {{ known?: { tempo: object|null, key: object|null }|null, byApp?: boolean, retune?: { tempo: number, semitones: number }|null }} [o]
   *   known: tempo and key already read (as the track will play);
   *   retune: an exact tempo and key shift to build into the audio first
   */
  async load(file, { known = null, byApp = false, retune = null } = {}) {
    const ctx = this.ensureNodes();
    // If another track is dropped before this one finishes reading, the
    // newest one wins.
    const ticket = ++this.loadTicket;
    const bytes = await file.arrayBuffer();
    let buffer = await ctx.decodeAudioData(bytes);
    if (ticket !== this.loadTicket) return;
    if (retune) {
      buffer = await stretchBuffer(buffer, retune.tempo, ctx, retune.semitones);
      if (ticket !== this.loadTicket) return;
    }
    if (!byApp) this.touched();
    this.stop();
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    this.buffer = buffer;
    this.clearStretch();
    this.name = tidyName(file.name);
    this.peaks = computePeaks(channels, WAVEFORM_BARS);
    this.offset = 0;
    this.cue = 0;
    this.loop = null;
    this.cueKey = cueKey(file.name.replace(/\.[^.]+$/, ""), buffer.duration); // the real name: cues saved before stay found
    this.hotCues = savedCues(this.cueKey);
    if (known) {
      this.analysis = { status: "done", tempo: known.tempo, key: known.key };
      this.emit();
      return;
    }
    this.analysis = { status: "working", tempo: null, key: null };
    this.emit();
    // Tempo and key are read in the background; the track can play meanwhile.
    void this.analyze(buffer);
  }

  async analyze(buffer) {
    try {
      const result = await analyzeBuffer(buffer);
      if (this.buffer !== buffer) return; // a newer track was loaded meanwhile
      this.analysis = { status: "done", tempo: result.tempo, key: result.key };
    } catch {
      if (this.buffer !== buffer) return;
      this.analysis = { status: "failed", tempo: null, key: null };
    }
    this.emit();
  }

  /**
   * Play from now on a stretched / shifted copy (the transition sets this
   * while the deck is stopped).
   */
  setStretch({ buffer, stretchTempo, pitchRate, semitones, heardBpm = null }) {
    this.stop();
    this.stretched = buffer;
    this.stretchTempo = stretchTempo;
    this.pitchRate = pitchRate;
    this.semitones = semitones;
    this.heardBpm = heardBpm;
    this.emit();
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  /** Where the playhead is right now, in track seconds. */
  get position() {
    if (!this.playing || !context) return this.offset;
    const now = context.currentTime;
    // A swap to another speed is scheduled but hasn't happened yet.
    if (this.before && now < this.playStart) {
      const b = this.before;
      return Math.min(this.duration, b.from + Math.max(0, now - b.start) * b.speed);
    }
    const elapsed = Math.max(0, now - this.playStart);
    return Math.min(this.duration, wrapPosition(this.playFrom + elapsed * this.speed, this.loop));
  }

  /** A swap to another copy is scheduled and hasn't happened yet. */
  get swapPending() {
    if (this.before && context && context.currentTime >= this.playStart) this.before = null; // it has happened
    return Boolean(this.before);
  }

  /** Where the playhead will be at context time `when` (if nothing changes). */
  positionAt(when) {
    if (!this.playing) return this.offset;
    return Math.min(this.duration, wrapPosition(this.playFrom + Math.max(0, when - this.playStart) * this.speed, this.loop));
  }

  play() {
    if (!this.buffer || this.playing) return;
    this.startAt(audioContext().currentTime, this.offset, { keepLoop: true });
  }

  /**
   * Start playing at an exact moment (context time), from a point in the
   * track (track seconds). Used by Play and by the transition, which starts
   * the next track exactly on the bar.
   */
  startAt(when, trackSeconds, { keepLoop = false } = {}) {
    if (!this.buffer) return;
    const ctx = this.ensureNodes();
    const loop = keepLoop ? this.loop : null;
    this.stop();
    this.loop = loop;
    let from = trackSeconds >= this.duration ? 0 : Math.max(0, trackSeconds);
    const source = ctx.createBufferSource();
    source.buffer = this.stretched || this.buffer;
    source.playbackRate.value = this.pitchRate;
    const gain = ctx.createGain();
    source.connect(gain).connect(this.volumeNode);
    source.onended = () => {
      // Only react if this is still the active source and it ran to the end.
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.offset = this.duration;
      this.emit();
    };
    const bufferOffset = onSample(this.stretched ? from / this.stretchTempo : from, source.buffer.sampleRate);
    const start = onSample(Math.max(when, ctx.currentTime), ctx.sampleRate);
    source.start(start, Math.min(bufferOffset, source.buffer.duration));
    this.playFrom = from;
    this.playStart = start;
    this.before = null;
    this.offset = from;
    this.source = source;
    this.sourceGain = gain;
    this.playing = true;
    if (this.echo > 0) this.applyKnobs(); // the echo follows this track's tempo
    this.applyLoop();
    this.emit();
  }

  // ---- hot cues and loops ------------------------------------------------

  /** Tell the playing source about the loop (its points are in the copy's seconds). */
  applyLoop() {
    const s = this.source;
    if (!s) return;
    if (!this.loop) {
      s.loop = false;
      return;
    }
    const k = this.stretched ? this.stretchTempo : 1;
    s.loopStart = this.loop.start / k;
    s.loopEnd = this.loop.end / k;
    s.loop = true;
  }

  /** From here on, count the playhead from where it is now (after a loop change). */
  rebase() {
    if (!this.playing || !context) return;
    const p = this.position;
    this.playFrom = p;
    this.playStart = context.currentTime;
    this.before = null;
  }

  /**
   * Beat loop of `beats` (½ … 16). Pressing the length that's looping lets
   * go; another length resizes the loop, keeping its start.
   */
  setLoop(beats) {
    const t = this.analysis.tempo;
    if (!this.buffer || !t) return;
    this.touched();
    if (this.loop && this.loop.beats === beats) return this.exitLoop();
    const pos = this.position;
    const next = this.loop ? resizeLoop(this.loop, t, beats) : loopAt(pos, t, beats);
    if (next.end > this.duration) return;
    if (!this.playing) {
      this.loop = next;
      this.emit();
      return;
    }
    if (pos >= next.end || pos < next.start) {
      // Shorter than where the playhead is: carry on inside the new loop.
      this.loop = next;
      this.jumpTo(wrapPosition(pos, next), { keepLoop: true });
      return;
    }
    this.rebase();
    this.loop = next;
    this.applyLoop();
    this.emit();
  }

  /** Let go of the loop: the track carries on from where it is. */
  exitLoop() {
    if (!this.loop) return;
    this.rebase();
    this.loop = null;
    this.applyLoop();
    this.emit();
  }

  /** Hot cue: empty = set it here (on the nearest beat); set = jump there, in time. */
  pressHotCue(i) {
    if (!this.buffer) return;
    this.touched();
    const t = this.analysis.tempo;
    if (this.hotCues[i] === null) {
      this.hotCues = this.hotCues.map((c, k) => (k === i ? quantize(this.position, t) : c));
      saveCues(this.cueKey, this.hotCues);
      this.emit();
      return;
    }
    // The jump happens 10 ms from now (see jumpTo): land where the beat will be then.
    const at = this.playing ? this.position + JUMP_LEAD * this.speed : this.position;
    const target = Math.max(0, Math.min(this.duration - 0.05, jumpTarget(at, this.hotCues[i], t, this.playing)));
    this.loop = null;
    if (this.playing) this.jumpTo(target);
    else {
      this.offset = target;
      this.emit();
    }
  }

  clearHotCue(i) {
    this.hotCues = this.hotCues.map((c, k) => (k === i ? null : c));
    saveCues(this.cueKey, this.hotCues);
    this.emit();
  }

  /** Jump while playing, with a 10 ms cross-fade so it never clicks. */
  jumpTo(trackSeconds, { keepLoop = false } = {}) {
    if (!this.playing || !this.source) return;
    const ctx = audioContext();
    const when = onSample(ctx.currentTime + JUMP_LEAD, ctx.sampleRate);
    const fade = 0.01;
    const old = this.source;
    const oldGain = this.sourceGain;
    oldGain.gain.setValueAtTime(1, when);
    oldGain.gain.linearRampToValueAtTime(0, when + fade);
    old.onended = null;
    old.stop(when + fade + 0.01);
    const loop = keepLoop ? this.loop : null;
    const source = ctx.createBufferSource();
    source.buffer = this.stretched || this.buffer;
    source.playbackRate.value = this.pitchRate;
    const gain = ctx.createGain();
    source.connect(gain).connect(this.volumeNode);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + fade);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.offset = this.duration;
      this.emit();
    };
    const k = this.stretched ? this.stretchTempo : 1;
    source.start(when, Math.min(onSample(trackSeconds / k, source.buffer.sampleRate), source.buffer.duration));
    this.source = source;
    this.sourceGain = gain;
    this.playFrom = trackSeconds;
    this.playStart = when;
    this.before = null;
    this.loop = loop;
    this.applyLoop();
    this.emit();
  }

  /**
   * While playing, switch to another copy of the track (another tempo) at
   * context time `when`, from exactly where the playhead will be then, with
   * a 20 ms cross-fade so nothing clicks. Used by the tempo journey to let a
   * track settle back to its own tempo on a phrase line.
   */
  swapAt(when, { buffer, stretchTempo, pitchRate, semitones, heardBpm = null }) {
    if (!this.playing || !this.source) return false;
    const ctx = audioContext();
    if (when < ctx.currentTime + 0.05) return false;
    when = onSample(when, ctx.sampleRate);
    const at = this.positionAt(when);
    const source = ctx.createBufferSource();
    source.buffer = buffer || this.buffer;
    source.playbackRate.value = pitchRate;
    const gain = ctx.createGain();
    source.connect(gain).connect(this.volumeNode);
    const fade = 0.02;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + fade);
    const old = this.source;
    const oldGain = this.sourceGain;
    oldGain.gain.setValueAtTime(1, when);
    oldGain.gain.linearRampToValueAtTime(0, when + fade);
    old.onended = null;
    old.stop(when + fade + 0.01);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.offset = this.duration;
      this.emit();
    };
    source.start(when, Math.min(onSample(buffer ? at / stretchTempo : at, source.buffer.sampleRate), source.buffer.duration));
    this.loop = null; // a swap carries on straight (transitions and polish never happen inside a loop)
    this.before = { from: this.playFrom, start: this.playStart, speed: this.speed };
    this.stretched = buffer;
    this.stretchTempo = stretchTempo;
    this.pitchRate = pitchRate;
    this.semitones = semitones;
    this.heardBpm = heardBpm;
    this.playFrom = at;
    this.playStart = when;
    this.source = source;
    this.sourceGain = gain;
    this.emit();
    return true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position;
    this.stop();
    this.emit();
  }

  /** Stop the sound without changing where we are. */
  stop() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
      this.sourceGain?.disconnect();
      this.sourceGain = null;
    }
    this.before = null;
    this.playing = false;
  }

  toggle() {
    this.touched();
    if (this.playing) this.pause();
    else this.play();
  }

  /** Cue button, CDJ style (see pressCue in lib/mixer.js). */
  pressCue() {
    if (!this.buffer) return;
    this.touched();
    const next = pressCue({ playing: this.playing, position: this.position, cue: this.cue });
    this.stop();
    this.loop = null;
    this.offset = next.position;
    this.cue = next.cue;
    this.emit();
  }

  /** Jump to a point in the track (0..1 of its length). Keeps playing if it was. */
  seek(fraction) {
    if (!this.buffer) return;
    this.touched();
    const wasPlaying = this.playing;
    this.stop();
    this.loop = null;
    this.offset = clamp(fraction, 0, 1) * this.duration;
    if (wasPlaying) this.play();
    else this.emit();
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (this.volumeNode) this.volumeNode.gain.setTargetAtTime(this.volume, context.currentTime, SMOOTH);
    this.emit();
  }

  setFaderGain(value) {
    this.fader = clamp(value, 0, 1);
    if (this.faderNode) {
      const g = this.faderNode.gain;
      const t = context.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(this.fader, t, SMOOTH);
    }
  }

  // ---- the DJ's knobs -----------------------------------------------------

  /** LOW / MID / HIGH knob (−1 … +1). */
  setEq(band, value) {
    if (!(band in this.eq)) return;
    this.eq = { ...this.eq, [band]: Math.max(-1, Math.min(1, Number(value) || 0)) };
    this.applyKnobs();
    this.emit();
  }

  /** Kill a band (or bring it back) in one press. */
  toggleKill(band) {
    if (!(band in this.kills)) return;
    this.kills = { ...this.kills, [band]: !this.kills[band] };
    this.applyKnobs();
    this.emit();
  }

  /** FILTER knob: −1 low-pass … 0 off … +1 high-pass. */
  setFilter(value) {
    this.filter = Math.max(-1, Math.min(1, Number(value) || 0));
    this.applyKnobs();
    this.emit();
  }

  /** ECHO / VERB amount (0 … 1). */
  setFx(kind, value) {
    if (kind !== "echo" && kind !== "verb") return;
    this[kind] = Math.max(0, Math.min(1, Number(value) || 0));
    this.applyKnobs();
    this.emit();
  }

  /** All the DJ's knobs back to the middle. */
  resetKnobs() {
    this.eq = { low: 0, mid: 0, high: 0 };
    this.kills = { low: false, mid: false, high: false };
    this.filter = 0;
    this.echo = 0;
    this.verb = 0;
    this.applyKnobs();
    this.emit();
  }

  /** Send the knob positions to the audio (smoothly, so turning never clicks). */
  applyKnobs(now = false) {
    const k = this.knobs;
    if (!k) return;
    const t = context.currentTime;
    const set = (param, value, tc = 0.015) => {
      if (now) param.value = value;
      else param.setTargetAtTime(value, t, tc);
    };
    for (const band of Object.keys(this.eq)) set(k[band].gain, this.kills[band] ? -40 : eqGainDb(this.eq[band]));
    const f = filterHz(this.filter);
    set(k.lp.frequency, f.lowpass, 0.02);
    set(k.hp.frequency, f.highpass, 0.02);
    set(k.echoSend.gain, this.echo * 0.8);
    set(k.echoDelay.delayTime, echoSeconds(this.playingBpm), 0.05);
    set(k.verbSend.gain, this.verb * 0.9);
  }

  /** Bass and mid EQ back to flat, filter open, echo send off, straight away. */
  resetEq() {
    const t = context.currentTime;
    for (const node of [this.bassNode, this.midNode]) {
      if (!node) continue;
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(0, t);
    }
    if (this.filterNode) {
      this.filterNode.frequency.cancelScheduledValues(t);
      this.filterNode.frequency.setValueAtTime(10, t);
    }
    if (this.sendNode) {
      this.sendNode.gain.cancelScheduledValues(t);
      this.sendNode.gain.setValueAtTime(0, t);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener();
  }
}

export const decks = { a: new Deck("a"), b: new Deck("b") };

/**
 * The echo used by the echo-out bridge: both decks' echo sends feed one delay
 * with feedback (thinned out top and bottom so the repeats sit back), into
 * the master. Silent unless a send is turned up.
 */
let echo = null;
export function echoBus(ctx = audioContext()) {
  if (!echo) {
    const input = ctx.createGain();
    const delay = ctx.createDelay(4);
    const feedback = ctx.createGain();
    const low = ctx.createBiquadFilter();
    low.type = "highpass";
    low.frequency.value = 250;
    const high = ctx.createBiquadFilter();
    high.type = "lowpass";
    high.frequency.value = 6000;
    const out = ctx.createGain();
    input.connect(delay);
    delay.connect(low).connect(high);
    high.connect(feedback).connect(delay);
    high.connect(out).connect(master);
    feedback.gain.value = 0.55;
    echo = { input, delay, feedback, out };
  }
  return echo.input;
}

/** The shared reverb (a hall made of fading noise), into the master. */
export function reverbBus(ctx = audioContext()) {
  if (!reverb) {
    const input = ctx.createGain();
    const conv = ctx.createConvolver();
    const ir = reverbImpulse(ctx.sampleRate);
    const buffer = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
    buffer.copyToChannel(ir[0], 0);
    buffer.copyToChannel(ir[1], 1);
    conv.buffer = buffer;
    const tone = ctx.createBiquadFilter();
    tone.type = "highpass";
    tone.frequency.value = 220; // no boomy reverb on the kick
    input.connect(tone).connect(conv).connect(master);
    reverb = { input };
  }
  return reverb.input;
}

/** The echo's controls: delay time (s), feedback (0–1). */
export function echoControls() {
  echoBus();
  return echo;
}

/**
 * The crossfader's position, shared by the slider and the transition
 * (which moves it to the new deck when it finishes).
 * -1 = all A, 0 = both, +1 = all B. `locked` while a transition runs.
 */
export const crossfader = {
  position: 0,
  locked: false,
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

/** Move the crossfader (-1 = all A, 0 = both, +1 = all B). */
export function setCrossfader(position) {
  crossfader.position = clamp(position, -1, 1);
  if (decks.a.faderNode || decks.b.faderNode) {
    const g = crossfadeGains(crossfader.position);
    decks.a.setFaderGain(g.a);
    decks.b.setFaderGain(g.b);
  } else {
    const g = crossfadeGains(crossfader.position);
    decks.a.fader = g.a;
    decks.b.fader = g.b;
  }
  crossfader.emit();
}
