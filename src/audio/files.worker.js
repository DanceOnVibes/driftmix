/**
 * Background worker for the Files section: sets exact BPM and key, trims,
 * levels and encodes one
 * track at a time without freezing the page. Everything stays on the device.
 */
import { encodeMp3 } from "../lib/files/mp3.js";
import { encodeWav } from "../lib/files/wav.js";
import { integratedLufs, loudnessGain } from "../lib/files/loudness.js";
import { trimSilence, toMono, peakDb, applyGainDb } from "../lib/files/tools.js";
import { retune } from "../lib/files/retune.js";

self.onmessage = (event) => {
  const { id, channels, sampleRate, settings, tags, plan } = event.data;
  try {
    let ch = channels;
    if (settings.channels === "mono") ch = toMono(ch);
    if (plan?.changed) {
      self.postMessage({ id, progress: 0.02 });
      ch = retune(ch, sampleRate, plan);
      self.postMessage({ id, progress: 0.35 });
    }
    let trimmed = 0;
    if (settings.trim) {
      const before = ch[0].length;
      ch = trimSilence(ch, sampleRate).channels;
      trimmed = (before - ch[0].length) / sampleRate;
    }
    let loudness = null;
    if (settings.loudness !== "off") {
      const measured = integratedLufs(ch, sampleRate);
      loudness = loudnessGain(measured, peakDb(ch), Number(settings.loudness), -1);
      applyGainDb(ch, loudness.gainDb);
    }
    const done = plan?.changed ? 0.35 : 0;
    const progress = (f) => self.postMessage({ id, progress: done + (1 - done) * f });
    const bytes =
      settings.format === "mp3"
        ? encodeMp3(ch, sampleRate, settings.bitrate, tags, progress)
        : encodeWav(ch, sampleRate, settings.bitDepth, tags);
    self.postMessage({ id, result: { bytes, loudness, trimmed, seconds: ch[0].length / sampleRate } }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
