/**
 * Background worker: the heavy sums, done without freezing the page.
 *  - "analyze": tempo and key of a track (one channel of samples in).
 *  - "stretch": a time-stretched copy of a track (all channels in and out).
 *  - "grid": the exact local tempo and beat of a slice (just before a mix).
 *  - "sections": the tempo section by section (does it wander?).
 *  - "pitch": the sung pitch of a Vocal Booth take, every 10 ms.
 * Everything happens on the DJ's own computer.
 */
import { analyzeTrack } from "../lib/analyze.js";
import { timeStretch } from "../lib/stretch.js";
import { retune } from "../lib/files/retune.js";
import { fitLocalGrid } from "../lib/tempo.js";
import { downsample } from "../lib/analyze.js";
import { tempoSections, steadiness } from "../lib/steady.js";
import { detectPitch } from "../lib/booth/pitch.js";

self.onmessage = (event) => {
  const { id, type = "analyze" } = event.data;
  try {
    if (type === "pitch") {
      const { samples, sampleRate } = event.data;
      const track = detectPitch(samples, sampleRate);
      self.postMessage({ id, result: track }, [track.f0.buffer]);
    } else if (type === "sections") {
      const { samples, sampleRate, bpm } = event.data;
      const d = downsample(samples, sampleRate);
      self.postMessage({ id, result: steadiness(tempoSections(d.samples, d.sampleRate, bpm)) });
    } else if (type === "grid") {
      const { samples, sampleRate, bpm } = event.data;
      const d = downsample(samples, sampleRate);
      self.postMessage({ id, result: fitLocalGrid(d.samples, d.sampleRate, bpm) });
    } else if (type === "stretch") {
      // A key shift is built into the copy (stretch, then a clean resample),
      // so it never goes through the browser's rough speed change.
      const { channels, sampleRate, tempo, semitones = 0 } = event.data;
      const out = semitones ? retune(channels, sampleRate, { tempo, semitones }) : timeStretch(channels, sampleRate, tempo);
      self.postMessage({ id, result: out }, out.map((c) => c.buffer));
    } else {
      const { samples, sampleRate } = event.data;
      self.postMessage({ id, result: analyzeTrack(samples, sampleRate) });
    }
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
