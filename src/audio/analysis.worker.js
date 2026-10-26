/**
 * Background worker: reads a track's tempo and key without freezing the page.
 * It receives the track as one channel of samples and sends back the result.
 * Everything happens on the DJ's own computer.
 */
import { analyzeTrack } from "../lib/analyze.js";

self.onmessage = (event) => {
  const { id, samples, sampleRate } = event.data;
  try {
    self.postMessage({ id, result: analyzeTrack(samples, sampleRate) });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
