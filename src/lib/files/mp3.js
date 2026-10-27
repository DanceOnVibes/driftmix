/**
 * MP3 files, encoded with LAME (via lamejs) at a constant bit rate, with an
 * ID3 tag in front. MP3 supports 32, 44.1 and 48 kHz (and half those).
 */
import lamejs from "../../vendor/lame.js";
import { buildId3, concat } from "./id3.js";
import { toInt } from "./tools.js";

export const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
export const MP3_BITRATES = [128, 192, 256, 320];

/**
 * @param {Float32Array[]} channels  one (mono) or two (stereo)
 * @param {number} sampleRate
 * @param {number} kbps
 * @param {object} [tags]
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Uint8Array}
 */
export function encodeMp3(channels, sampleRate, kbps = 320, tags = null, onProgress = null) {
  if (!MP3_RATES.includes(sampleRate)) throw new Error(`MP3 can't be ${sampleRate} Hz`);
  const stereo = channels.length > 1;
  const left = toInt(channels[0], 16, 0x51ed);
  const right = stereo ? toInt(channels[1], 16, 0x2701) : null;
  const encoder = new lamejs.Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps);
  const parts = [];
  const block = 1152 * 32;
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    const out = stereo ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l);
    if (out.length) parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice());
    if (onProgress && (i / block) % 8 === 0) onProgress(i / left.length);
  }
  const end = encoder.flush();
  if (end.length) parts.push(new Uint8Array(end.buffer, end.byteOffset, end.length).slice());
  onProgress?.(1);
  return concat([tags ? buildId3(tags) : new Uint8Array(0), ...parts]);
}
