/**
 * Sends a decoded track to the background worker for tempo and key.
 * One worker is shared by both decks; each request gets its own answer.
 */
let worker = null;
let nextId = 1;
const waiting = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./analysis.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const job = waiting.get(id);
      if (!job) return;
      waiting.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    };
    worker.onerror = (event) => {
      // The worker itself broke: fail every waiting job and start fresh next time.
      for (const job of waiting.values()) job.reject(new Error(event.message || "Analysis failed"));
      waiting.clear();
      worker.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Mix all channels down to one (the worker only needs mono). */
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
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    // "Transfer" hands the samples over without copying them.
    getWorker().postMessage({ id, samples, sampleRate: buffer.sampleRate }, [samples.buffer]);
  });
}
