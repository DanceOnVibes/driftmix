/**
 * Studio-grade time-stretch: Signalsmith Stretch (MIT licence, by Geraint
 * Luff / Signalsmith Audio), the same kind of engine music software uses for
 * "complex" warping. It's a WebAssembly build, so it runs at full speed in the
 * background worker.
 *
 * Compared with DriftMix's own phase vocoder it keeps drum hits sharper
 * (less "smear" before a kick) and held notes clean, and it can shift the key
 * at the same time as the tempo in one pass.
 *
 * Timing is sample-exact: the copy starts at the same musical moment as the
 * original (the engine's delay is measured and removed) and is exactly
 * length / tempo long, so the beat grid stays where the mix expects it.
 */
import SignalsmithStretch from "../vendor/signalsmith-stretch/main.js";

let ready = null;

/** Load the engine once (a few ms; it's built into the file, nothing is downloaded). */
export function loadSignalsmith() {
  ready ??= SignalsmithStretch();
  return ready;
}

const BLOCK = 16384; // samples per channel handed over at a time

/**
 * @param {object} M  the loaded engine (from loadSignalsmith)
 * @param {Float32Array[]} channels  the track, one array per channel
 * @param {number} sampleRate
 * @param {number} tempo  1.03 = 3% faster (shorter), 0.97 = 3% slower (longer)
 * @param {number} [semitones]  key shift at the same time, e.g. +1
 * @returns {Float32Array[]} each Math.ceil(length / tempo) long
 */
export function signalsmithStretch(M, channels, sampleRate, tempo, semitones = 0) {
  if (!(tempo > 0)) throw new Error("tempo must be positive");
  const C = channels.length;
  const length = channels[0].length;
  const outLength = Math.ceil(length / tempo);
  M._presetDefault(C, sampleRate);
  M._reset();
  // The tonality limit keeps very high sounds (cymbals, air) from being
  // over-processed when the key moves; it doesn't touch the notes.
  M._setTransposeSemitones(semitones, 8000 / sampleRate);
  const inLatency = M._inputLatency();
  const outLatency = M._outputLatency();

  const ptr = M._setBuffers(C, BLOCK);
  const view = () => new Float32Array(M.HEAP8.buffer, ptr, BLOCK * C * 2); // fresh each time: the memory can grow
  const out = channels.map(() => new Float32Array(outLength));
  // The engine's own delay: its output runs this many samples behind, so the
  // first outLatency samples come before the track starts and are dropped.
  const preroll = outLatency;
  let written = 0; // output samples produced so far (pre-roll included)

  const keep = (count) => {
    const heap = view();
    for (let c = 0; c < C; c++) {
      const o = out[c];
      const base = BLOCK * (C + c);
      for (let i = 0; i < count; i++) {
        const at = written + i - preroll;
        if (at >= 0 && at < outLength) o[at] = heap[base + i];
      }
    }
    written += count;
  };
  const feed = (from, count) => {
    const heap = view();
    for (let c = 0; c < C; c++) {
      const x = channels[c];
      const base = BLOCK * c;
      for (let i = 0; i < count; i++) heap[base + i] = from + i < length ? x[from + i] : 0;
    }
  };

  // Start: the first inLatency samples, so processing begins right at 0.
  feed(0, inLatency);
  M._seek(inLatency, tempo);
  let fed = inLatency;
  // The rest of the track, plus inLatency of silence so the end comes out too.
  const end = length + inLatency;
  const step = Math.floor(BLOCK * Math.min(1, tempo) * 0.95); // so each output block fits too
  while (fed < end) {
    const n = Math.min(step, end - fed);
    // Output kept in step with the input (the engine takes its rate from the two counts).
    const want = Math.round((fed + n - inLatency) / tempo) - written;
    feed(fed, n);
    M._process(n, want);
    keep(want);
    fed += n;
  }
  // What's still inside the engine.
  let left = outLength + preroll - written;
  while (left > 0) {
    const n = Math.min(left, Math.max(outLatency, 1), BLOCK);
    M._flush(n);
    keep(n);
    left -= n;
  }
  return out;
}
