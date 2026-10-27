/**
 * The audio engine: two decks and a crossfader, built on the browser's own
 * Web Audio. Tracks are read from the DJ's computer and stay there.
 *
 * Signal path for each deck:
 *   track → deck volume → bass EQ → crossfader gain → master → speakers
 *
 * The bass EQ is a low shelf the transition button uses for the bass swap.
 *
 * Browsers only allow sound to start after the person clicks something, so the
 * audio context is created (or woken up) on the first click.
 *
 * Positions ("offset", "position", "cue") are always in track seconds: where
 * you are in the original file. After a transition a deck may play a
 * stretched copy at another tempo; `speed` converts between the two.
 */
import { computePeaks } from "../lib/peaks.js";
import { crossfadeGains, clamp, pressCue } from "../lib/mixer.js";
import { shiftCamelot } from "../lib/match.js";
import { analyzeBuffer } from "./analysis.js";

/** Smooth volume changes over ~15 ms so faders never click. */
const SMOOTH = 0.015;
export const WAVEFORM_BARS = 1200;
/** Bass EQ: the low shelf sits at 180 Hz; "cut" is −30 dB. */
export const BASS_HZ = 180;
export const BASS_CUT = -30;

let context = null;
let master = null;

export function audioContext() {
  if (!context) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    context = new Ctx();
    master = context.createGain();
    master.connect(context.destination);
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
    this.playing = false;
    this.offset = 0; // where in the track we are while paused (track seconds)
    this.playFrom = 0; // track seconds where the current playback began
    this.playStart = 0; // context time when it began (may be in the future)
    this.cue = 0;
    this.listeners = new Set();
    this.loadTicket = 0;
    this.volume = 1;
    this.fader = 1;
    this.volumeNode = null;
    this.bassNode = null;
    this.faderNode = null;
    this.clearStretch();
    /** Called when the DJ presses something on this deck (the transition listens). */
    this.onUserAction = null;
  }

  /** Back to the original track: normal tempo, normal key. */
  clearStretch() {
    this.stretched = null; // AudioBuffer of the stretched copy, or null
    this.stretchTempo = 1; // track seconds per stretched-copy second
    this.pitchRate = 1; // playback rate (the key shift)
    this.semitones = 0;
  }

  /** Track seconds per real second (1 = original tempo). */
  get speed() {
    return this.stretchTempo * this.pitchRate;
  }

  /** The tempo and key the audience hears right now. */
  get playingBpm() {
    const t = this.analysis.tempo;
    return t ? t.bpm * this.speed : null;
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
      this.faderNode = ctx.createGain();
      this.volumeNode.connect(this.bassNode);
      this.bassNode.connect(this.faderNode);
      this.faderNode.connect(master);
      this.volumeNode.gain.value = this.volume;
      this.faderNode.gain.value = this.fader;
    }
    return ctx;
  }

  /** Read a file from the computer and get it ready to play. */
  async load(file) {
    const ctx = this.ensureNodes();
    // If another track is dropped before this one finishes reading, the
    // newest one wins.
    const ticket = ++this.loadTicket;
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    if (ticket !== this.loadTicket) return;
    this.onUserAction?.(this);
    this.stop();
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    this.buffer = buffer;
    this.clearStretch();
    this.name = file.name.replace(/\.[^.]+$/, "");
    this.peaks = computePeaks(channels, WAVEFORM_BARS);
    this.offset = 0;
    this.cue = 0;
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
  setStretch({ buffer, stretchTempo, pitchRate, semitones }) {
    this.stop();
    this.stretched = buffer;
    this.stretchTempo = stretchTempo;
    this.pitchRate = pitchRate;
    this.semitones = semitones;
    this.emit();
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  /** Where the playhead is right now, in track seconds. */
  get position() {
    if (!this.playing || !context) return this.offset;
    const elapsed = Math.max(0, context.currentTime - this.playStart);
    return Math.min(this.duration, this.playFrom + elapsed * this.speed);
  }

  play() {
    if (!this.buffer || this.playing) return;
    this.startAt(audioContext().currentTime, this.offset);
  }

  /**
   * Start playing at an exact moment (context time), from a point in the
   * track (track seconds). Used by Play and by the transition, which starts
   * the next track exactly on the bar.
   */
  startAt(when, trackSeconds) {
    if (!this.buffer) return;
    const ctx = this.ensureNodes();
    this.stop();
    let from = trackSeconds >= this.duration ? 0 : Math.max(0, trackSeconds);
    const source = ctx.createBufferSource();
    source.buffer = this.stretched || this.buffer;
    source.playbackRate.value = this.pitchRate;
    source.connect(this.volumeNode);
    source.onended = () => {
      // Only react if this is still the active source and it ran to the end.
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.offset = this.duration;
      this.emit();
    };
    const bufferOffset = this.stretched ? from / this.stretchTempo : from;
    source.start(Math.max(when, ctx.currentTime), Math.min(bufferOffset, source.buffer.duration));
    this.playFrom = from;
    this.playStart = Math.max(when, ctx.currentTime);
    this.offset = from;
    this.source = source;
    this.playing = true;
    this.emit();
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
    }
    this.playing = false;
  }

  toggle() {
    this.onUserAction?.(this);
    if (this.playing) this.pause();
    else this.play();
  }

  /** Cue button, CDJ style (see pressCue in lib/mixer.js). */
  pressCue() {
    if (!this.buffer) return;
    this.onUserAction?.(this);
    const next = pressCue({ playing: this.playing, position: this.position, cue: this.cue });
    this.stop();
    this.offset = next.position;
    this.cue = next.cue;
    this.emit();
  }

  /** Jump to a point in the track (0..1 of its length). Keeps playing if it was. */
  seek(fraction) {
    if (!this.buffer) return;
    this.onUserAction?.(this);
    const wasPlaying = this.playing;
    this.stop();
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

  /** Bass EQ back to flat, straight away. */
  resetBass() {
    if (!this.bassNode) return;
    const g = this.bassNode.gain;
    g.cancelScheduledValues(context.currentTime);
    g.setValueAtTime(0, context.currentTime);
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
