/**
 * The audio engine: two decks and a crossfader, built on the browser's own
 * Web Audio. Tracks are read from the DJ's computer and stay there.
 *
 * Signal path for each deck:
 *   track → deck volume → crossfader gain → master → speakers
 *
 * Browsers only allow sound to start after the person clicks something, so the
 * audio context is created (or woken up) on the first click.
 */
import { computePeaks } from "../lib/peaks.js";
import { crossfadeGains, clamp, pressCue } from "../lib/mixer.js";
import { analyzeBuffer } from "./analysis.js";

/** Smooth volume changes over ~15 ms so faders never click. */
const SMOOTH = 0.015;
export const WAVEFORM_BARS = 1200;

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
    this.offset = 0; // where in the track we are while paused (seconds)
    this.startedAt = 0; // context time when playback last started
    this.cue = 0;
    this.listeners = new Set();
    this.loadTicket = 0;
    this.volume = 1;
    this.fader = 1;
    this.volumeNode = null;
    this.faderNode = null;
  }

  ensureNodes() {
    const ctx = audioContext();
    if (!this.volumeNode) {
      this.volumeNode = ctx.createGain();
      this.faderNode = ctx.createGain();
      this.volumeNode.connect(this.faderNode);
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
    this.stop();
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    this.buffer = buffer;
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

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  /** Where the playhead is right now, in seconds. */
  get position() {
    if (!this.playing || !context) return this.offset;
    return Math.min(this.duration, context.currentTime - this.startedAt);
  }

  play() {
    if (!this.buffer || this.playing) return;
    const ctx = this.ensureNodes();
    if (this.offset >= this.duration) this.offset = 0;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.volumeNode);
    source.onended = () => {
      // Only react if this is still the active source and it ran to the end.
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.offset = this.duration;
      this.emit();
    };
    source.start(0, this.offset);
    this.startedAt = ctx.currentTime - this.offset;
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
    if (this.playing) this.pause();
    else this.play();
  }

  /** Cue button, CDJ style (see pressCue in lib/mixer.js). */
  pressCue() {
    if (!this.buffer) return;
    const next = pressCue({ playing: this.playing, position: this.position, cue: this.cue });
    this.stop();
    this.offset = next.position;
    this.cue = next.cue;
    this.emit();
  }

  /** Jump to a point in the track (0..1 of its length). Keeps playing if it was. */
  seek(fraction) {
    if (!this.buffer) return;
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
    if (this.faderNode) this.faderNode.gain.setTargetAtTime(this.fader, context.currentTime, SMOOTH);
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

/** Move the crossfader (-1 = all A, 0 = both, +1 = all B). */
export function setCrossfader(position) {
  const g = crossfadeGains(position);
  decks.a.setFaderGain(g.a);
  decks.b.setFaderGain(g.b);
}
