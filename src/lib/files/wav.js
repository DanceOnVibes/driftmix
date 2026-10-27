/**
 * WAV files: 16-bit or 24-bit PCM, with the title and other details stored
 * twice so every app finds them: a LIST/INFO chunk (Windows, most DAWs) and
 * an "id3 " chunk (DJ software, Mac apps).
 */
import { buildId3, concat } from "./id3.js";
import { toInt } from "./tools.js";

/**
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {16|24} bitDepth
 * @param {object} [tags]  same shape as buildId3's
 * @returns {Uint8Array}
 */
export function encodeWav(channels, sampleRate, bitDepth = 16, tags = null) {
  const nch = channels.length;
  const frames = channels[0].length;
  const bytesPer = bitDepth / 8;
  const ints = channels.map((c, i) => toInt(c, bitDepth, 0x9e3779b9 + i));
  const dataLen = frames * nch * bytesPer;
  const data = new Uint8Array(dataLen);
  let p = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const v = ints[c][i];
      data[p++] = v & 0xff;
      data[p++] = (v >> 8) & 0xff;
      if (bytesPer === 3) data[p++] = (v >> 16) & 0xff;
    }
  }
  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, 1, true); // PCM
  fv.setUint16(2, nch, true);
  fv.setUint32(4, sampleRate, true);
  fv.setUint32(8, sampleRate * nch * bytesPer, true);
  fv.setUint16(12, nch * bytesPer, true);
  fv.setUint16(14, bitDepth, true);

  const chunks = [chunk("fmt ", fmt), chunk("data", data)];
  if (tags) {
    const info = infoList(tags);
    if (info) chunks.push(info);
    chunks.push(chunk("id3 ", buildId3(tags)));
  }
  const body = concat([ascii("WAVE"), ...chunks]);
  return concat([ascii("RIFF"), u32(body.length), body]);
}

function infoList(tags) {
  const fields = [
    ["INAM", tags.title],
    ["IART", tags.artist],
    ["IPRD", tags.album],
    ["ITRK", tags.track],
    ["ICRD", tags.year],
    ["IGNR", tags.genre],
    ["ICMT", tags.comment],
    ["ICOP", tags.copyright],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
  if (!fields.length) return null;
  const subs = fields.map(([id, v]) => chunk(id, concat([new TextEncoder().encode(String(v)), Uint8Array.of(0)])));
  return chunk("LIST", concat([ascii("INFO"), ...subs]));
}

/** A RIFF chunk: id, size, data, and a pad byte when the size is odd. */
function chunk(id, data) {
  const pad = data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0);
  return concat([ascii(id), u32(data.length), data, pad]);
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function ascii(s) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
