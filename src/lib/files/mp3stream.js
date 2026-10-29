/**
 * MP3 encoding a bit at a time, for recording a set as it plays: sound goes
 * in in chunks, MP3 frames come out, and only those are kept (about 2.4 MB a
 * minute at 320 kbps, instead of 23 MB of raw audio).
 */
import lamejs from "../../vendor/lame.js";
import { MP3_RATES } from "./mp3.js";
import { buildId3, concat } from "./id3.js";
import { toInt } from "./tools.js";

export class Mp3Stream {
  constructor(sampleRate, kbps = 320) {
    if (!MP3_RATES.includes(sampleRate)) throw new Error(`MP3 can't be ${sampleRate} Hz`);
    this.encoder = new lamejs.Mp3Encoder(2, sampleRate, kbps);
    this.sampleRate = sampleRate;
    this.parts = [];
    this.bytes = 0;
    this.frames = 0; // samples per channel taken in
    this.chunk = 0;
  }

  /** Add sound (left and right, same length). */
  push(left, right = left) {
    const seed = 0x51ed + this.chunk++ * 7919;
    const out = this.encoder.encodeBuffer(toInt(left, 16, seed), toInt(right, 16, seed ^ 0x2701));
    this.keep(out);
    this.frames += left.length;
  }

  /** Add silence (to fill a gap and keep the timing). */
  silence(samples) {
    const z = new Float32Array(Math.min(samples, this.sampleRate * 10));
    for (let left = samples; left > 0; left -= z.length) this.push(z.subarray(0, Math.min(z.length, left)));
  }

  keep(out) {
    if (!out.length) return;
    const bytes = new Uint8Array(out.buffer, out.byteOffset, out.length).slice();
    this.parts.push(bytes);
    this.bytes += bytes.length;
  }

  /** Finish: the whole file, with an ID3 tag in front. */
  finish(tags = null) {
    this.keep(this.encoder.flush());
    return concat([tags ? buildId3(tags) : new Uint8Array(0), ...this.parts]);
  }
}
