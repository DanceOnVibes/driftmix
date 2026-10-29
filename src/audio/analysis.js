/**
 * Sends work to the background workers: tempo and key for a loaded track,
 * and stretched copies for the transition. Two workers, so a long stretch
 * never holds up reading a newly loaded track.
 */
let nextId = 1;
const waiting = new Map();
const workers = {};

function getWorker(kind) {
  if (!workers[kind]) {
    const worker = new Worker(new URL("./analysis.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const job = waiting.get(id);
      if (!job) return;
      waiting.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    };
    worker.onerror = (event) => {
      // The worker itself broke: fail its waiting jobs and start fresh next time.
      for (const [id, job] of waiting) {
        if (job.kind !== kind) continue;
        job.reject(new Error(event.message || "Background work failed"));
        waiting.delete(id);
      }
      worker.terminate();
      delete workers[kind];
    };
    workers[kind] = worker;
  }
  return workers[kind];
}

function run(kind, message, transfer) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, kind });
    getWorker(kind).postMessage({ id, ...message }, transfer);
  });
}

/** Mix all channels down to one (the analysis only needs mono). */
function mono(buffer) {
  const out = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

/**
 * @param {AudioBuffer} buffer
 * @returns {Promise<{ tempo: object|null, key: object|null, seconds: number }>}
 */
export function analyzeBuffer(buffer) {
  const samples = mono(buffer);
  // "Transfer" hands the samples over without copying them.
  return run("analyze", { type: "analyze", samples, sampleRate: buffer.sampleRate }, [samples.buffer]);
}

/**
 * The sung pitch of a voice recording, every 10 ms (its own worker, so it
 * never waits behind Files or Auto DJ).
 * @param {Float32Array} samples  mono (handed over, not copied)
 * @returns {Promise<{ hop: number, start: number, f0: Float32Array }>}
 */
export function pitchTrack(samples, sampleRate) {
  return run("pitch", { type: "pitch", samples, sampleRate }, [samples.buffer]);
}

/**
 * Does the tempo stay the same all the way through? (Read in sections.)
 * @returns {Promise<{ level: "steady"|"slight"|"wanders"|"unknown", min: number|null, max: number|null, percent: number }>}
 */
export function tempoSteadiness(buffer, bpm) {
  const samples = mono(buffer);
  return run("analyze", { type: "sections", samples, sampleRate: buffer.sampleRate, bpm }, [samples.buffer]);
}

/**
 * A time-stretched copy of a track, keeping its pitch.
 * @param {AudioBuffer} buffer
 * @param {number} tempo  e.g. 0.99 = 1% slower
 * @returns {Promise<AudioBuffer>}
 */
export async function stretchBuffer(buffer, tempo, context) {
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
  const out = await run(
    "stretch",
    { type: "stretch", channels, sampleRate: buffer.sampleRate, tempo },
    channels.map((c) => c.buffer),
  );
  const result = context.createBuffer(out.length, out[0].length, buffer.sampleRate);
  out.forEach((data, c) => result.copyToChannel(data, c));
  return result;
}

/**
 * The exact tempo and beat in one stretch of a track (track seconds from
 * `from` to `to`), measured fresh just before a mix.
 * @returns {Promise<{ bpm: number, beat: number, confidence: number } | null>}
 *   beat: track seconds of a beat in that stretch
 */
export async function localGrid(buffer, from, to, approxBpm) {
  const rate = buffer.sampleRate;
  const a = Math.max(0, Math.floor(from * rate));
  const b = Math.min(buffer.length, Math.ceil(to * rate));
  if (b - a < rate * 4) return null;
  const samples = new Float32Array(b - a);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < samples.length; i++) samples[i] += data[a + i] / buffer.numberOfChannels;
  }
  const r = await run("analyze", { type: "grid", samples, sampleRate: rate, bpm: approxBpm }, [samples.buffer]);
  return r && { ...r, beat: a / rate + r.beat };
}
