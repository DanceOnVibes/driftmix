/**
 * Background worker: the heavy sums, done without freezing the page.
 *  - "analyze": tempo and key of a track (one channel of samples in).
 *  - "stretch": a time-stretched copy of a track (all channels in and out).
 *  - "grid": the exact local tempo and beat of a slice (just before a mix).
 * Everything happens on the DJ's own computer.
 */
import { analyzeTrack } from "../lib/analyze.js";
import { timeStretch } from "../lib/stretch.js";
import { fitLocalGrid } from "../lib/tempo.js";
import { downsample } from "../lib/analyze.js";

self.onmessage = (event) => {
  const { id, type = "analyze" } = event.data;
  try {
    if (type === "grid") {
      const { samples, sampleRate, bpm } = event.data;
      const d = downsample(samples, sampleRate);
      self.postMessage({ id, result: fitLocalGrid(d.samples, d.sampleRate, bpm) });
    } else if (type === "stretch") {
      const { channels, sampleRate, tempo } = event.data;
      const out = timeStretch(channels, sampleRate, tempo);
      self.postMessage({ id, result: out }, out.map((c) => c.buffer));
    } else {
      const { samples, sampleRate } = event.data;
      self.postMessage({ id, result: analyzeTrack(samples, sampleRate) });
    }
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
