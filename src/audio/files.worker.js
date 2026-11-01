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
import { applyBass } from "../lib/files/bass.js";
import { extendTrack } from "../lib/files/extend.js";
import { studioReady } from "./studioStretch.js";

self.onmessage = async (event) => {
  await studioReady; // the studio time-stretch, ready in a few ms
  const { id, channels, sampleRate, settings, tags, plan, bassDb, extend } = event.data;
  try {
    let ch = channels;
    if (settings.channels === "mono") ch = toMono(ch);
    if (plan?.changed) {
      self.postMessage({ id, progress: 0.02 });
      ch = retune(ch, sampleRate, plan);
      self.postMessage({ id, progress: 0.35 });
    }
    // Extended mix: longer intro and outro from whole 8-bar phrases, on the grid.
    let extended = null;
    if (extend) {
      const r = extendTrack(ch, sampleRate, extend.grid, extend);
      ch = r.channels;
      extended = { introSeconds: r.introSeconds, addedSeconds: r.addedSeconds, introBar: r.plan.intro + 1, outroBar: r.plan.outro + 1 };
    }
    // Studio bass: rumble cut, warm shelf, mud dip, limiter (peaks under −1 dB).
    if (bassDb > 0) ch = applyBass(ch, sampleRate, bassDb).channels;
    let trimmed = 0;
    // (Not after an extended mix: it starts right on a downbeat and ends in a fade, and trimming could move the grid.)
    if (settings.trim && !extended) {
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
    self.postMessage({ id, result: { bytes, loudness, trimmed, extended, seconds: ch[0].length / sampleRate } }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
