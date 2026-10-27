/**
 * What's inside an audio file before decoding it: the format, its own sample
 * rate, channels and (for MP3) bit rate. Used for "keep original" sample rate
 * and to show what each file is now.
 * @returns {{ format: string, sampleRate?: number, channels?: number, bitrate?: number, bitDepth?: number }}
 */
export function sniff(bytes) {
  const b = bytes;
  const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") {
    for (let p = 12; p + 8 <= b.length; ) {
      const id = s(p, 4);
      const size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
      if (id === "fmt ") {
        const v = new DataView(b.buffer, b.byteOffset + p + 8, 16);
        return { format: "WAV", channels: v.getUint16(2, true), sampleRate: v.getUint32(4, true), bitDepth: v.getUint16(14, true) };
      }
      p += 8 + size + (size % 2);
    }
    return { format: "WAV" };
  }
  if (s(0, 4) === "fLaC") {
    // STREAMINFO: 20 bits sample rate, 3 bits channels-1, 5 bits bits-1.
    const o = 8 + 10;
    const sampleRate = (b[o] << 12) | (b[o + 1] << 4) | (b[o + 2] >> 4);
    const channels = ((b[o + 2] >> 1) & 7) + 1;
    const bitDepth = (((b[o + 2] & 1) << 4) | (b[o + 3] >> 4)) + 1;
    return { format: "FLAC", sampleRate, channels, bitDepth };
  }
  if (s(4, 4) === "ftyp") return { format: "M4A" };
  if (s(0, 4) === "OggS") return { format: "OGG" };
  // MP3: skip an ID3 tag, then find the first frame header.
  let p = 0;
  if (s(0, 3) === "ID3") p = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  for (let tries = 0; p + 4 <= b.length && tries < 65536; p++, tries++) {
    if (b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) continue;
    const version = (b[p + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[p + 1] >> 1) & 3; // 1 = Layer III
    const brIndex = b[p + 2] >> 4;
    const srIndex = (b[p + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || brIndex === 0 || brIndex === 15 || srIndex === 3) continue;
    const rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[version];
    const v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const channels = b[p + 3] >> 6 === 3 ? 1 : 2;
    return { format: "MP3", sampleRate: rates[srIndex], channels, bitrate: (version === 3 ? v1 : v2)[brIndex] };
  }
  return { format: "Audio" };
}
