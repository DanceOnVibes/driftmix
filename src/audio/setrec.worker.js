/**
 * Background worker for "Record the set": takes the sound of the master
 * output straight from the recorder in the audio engine (a direct line, so a
 * busy screen can never cause a gap) and turns it into MP3 as it comes.
 */
import { Mp3Stream } from "../lib/files/mp3stream.js";

let enc = null;
let expected = null; // the next audio-clock frame we should get
let tags = null;
let lastReport = 0;

function onChunk(m) {
  if (!enc) return;
  if (m.type === "chunk") {
    if (expected === null) {
      expected = m.frame;
      self.postMessage({ type: "started", frame: m.frame });
    }
    if (m.frame > expected) enc.silence(m.frame - expected); // a gap: keep the timing
    enc.push(m.left, m.right);
    expected = m.frame + m.left.length;
    if (enc.frames - lastReport >= enc.sampleRate) {
      lastReport = enc.frames;
      self.postMessage({ type: "progress", seconds: enc.frames / enc.sampleRate, bytes: enc.bytes });
    }
  } else if (m.type === "end") {
    const bytes = enc.finish(tags);
    const seconds = enc.frames / enc.sampleRate;
    enc = null;
    self.postMessage({ type: "done", bytes, seconds }, [bytes.buffer]);
  }
}

self.onmessage = (event) => {
  const m = event.data;
  try {
    if (m.type === "port") m.port.onmessage = (e) => onChunk(e.data);
    else if (m.type === "start") {
      enc = new Mp3Stream(m.sampleRate, m.kbps);
      expected = null;
      tags = null;
      lastReport = 0;
    } else if (m.type === "tags") tags = m.tags;
  } catch (error) {
    self.postMessage({ type: "error", message: String(error?.message || error) });
  }
};
