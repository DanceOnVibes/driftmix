// Files tests: WAV/MP3 writers, tags, zip, loudness. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav } from "./wav.js";
import { encodeMp3 } from "./mp3.js";
import { buildId3 } from "./id3.js";
import { makeZip, crc32 } from "./zip.js";
import { integratedLufs, loudnessGain } from "./loudness.js";
import { trimSilence, toMono, toInt, peakDb, applyGainDb } from "./tools.js";
import { shortKey, exportName, safeName } from "./naming.js";
import { sniff } from "./sniff.js";

const sine = (hz, seconds, rate, amp) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const str = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
const tags = { title: "Inspiration", artist: "DanceOnVibes – The Drift3r", album: "128 to 135", track: 1, year: 2026, genre: "Melodic House", bpm: 128, key: "Am", comment: "8A · Lyrics: Adalbert Roitan · Audio: AI-assisted", copyright: "All rights reserved" };

test("WAV 16-bit stereo: correct header, data size and tags", () => {
  const l = sine(440, 1, 44100, 0.5);
  const wav = encodeWav([l, l], 44100, 16, tags);
  assert.equal(str(wav, 0, 4), "RIFF");
  assert.equal(str(wav, 8, 4), "WAVE");
  const info = sniff(wav);
  assert.deepEqual(info, { format: "WAV", channels: 2, sampleRate: 44100, bitDepth: 16 });
  const text = new TextDecoder("latin1").decode(wav);
  assert.ok(text.includes("LIST") && text.includes("INFOINAM") && text.includes("Inspiration"));
  assert.ok(text.includes("id3 ") && text.includes("ID3"));
  // RIFF size = file size − 8
  assert.equal(new DataView(wav.buffer).getUint32(4, true), wav.length - 8);
});

test("WAV 24-bit mono: exact sample values survive", () => {
  const samples = Float32Array.of(0, 0.5, -0.5, 1, -1);
  const wav = encodeWav([samples], 48000, 24);
  assert.deepEqual(sniff(wav), { format: "WAV", channels: 1, sampleRate: 48000, bitDepth: 24 });
  const data = str(wav, 36, 4) === "data" ? 44 : -1;
  const read = (k) => {
    const o = data + k * 3;
    let v = wav[o] | (wav[o + 1] << 8) | (wav[o + 2] << 16);
    if (v & 0x800000) v -= 0x1000000;
    return v;
  };
  assert.deepEqual([0, 1, 2, 3, 4].map(read), [0, 4194304, -4194303, 8388607, -8388607]);
});

test("ID3: header size, frames and UTF-16 text (the en dash survives)", () => {
  const tag = buildId3({ ...tags, cover: { mime: "image/jpeg", bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) } });
  assert.equal(str(tag, 0, 3), "ID3");
  assert.equal(tag[3], 3);
  const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  assert.equal(size, tag.length - 10);
  const frames = {};
  for (let p = 10; p < tag.length; ) {
    const id = str(tag, p, 4);
    const n = (tag[p + 4] << 24) | (tag[p + 5] << 16) | (tag[p + 6] << 8) | tag[p + 7];
    frames[id] = tag.subarray(p + 10, p + 10 + n);
    p += 10 + n;
  }
  assert.deepEqual(Object.keys(frames), ["TIT2", "TPE1", "TALB", "TRCK", "TYER", "TCON", "TBPM", "TKEY", "TCOP", "COMM", "APIC"]);
  const text = (f) => new TextDecoder("utf-16le").decode(f.subarray(3));
  assert.equal(text(frames.TPE1), "DanceOnVibes – The Drift3r");
  assert.equal(text(frames.TBPM), "128");
  assert.equal(text(frames.TKEY), "Am");
  assert.equal(str(frames.APIC, 1, 10), "image/jpeg");
});

test("MP3: 320 kbps stereo 44.1 kHz, tag in front, frames readable", () => {
  const l = sine(440, 2, 44100, 0.4);
  const mp3 = encodeMp3([l, l], 44100, 320, tags);
  assert.equal(str(mp3, 0, 3), "ID3");
  assert.deepEqual(sniff(mp3), { format: "MP3", sampleRate: 44100, channels: 2, bitrate: 320 });
  const audioBytes = mp3.length - buildId3(tags).length;
  assert.ok(Math.abs(audioBytes - (320000 / 8) * 2) < 6000, `about 80 kB of audio for 2 s (${audioBytes})`);
});

test("MP3: mono 48 kHz 128 kbps; refuses rates MP3 can't do", () => {
  const m = sine(440, 1, 48000, 0.4);
  const mp3 = encodeMp3([m], 48000, 128);
  assert.deepEqual(sniff(mp3), { format: "MP3", sampleRate: 48000, channels: 1, bitrate: 128 });
  assert.throws(() => encodeMp3([m], 96000, 320));
});

test("loudness: a full-scale 997 Hz stereo sine at −20 dB reads −20 LUFS", () => {
  for (const rate of [44100, 48000]) {
    const s = sine(997, 5, rate, 0.1);
    assert.ok(Math.abs(integratedLufs([s, s], rate) - -20) < 0.1, `${rate} Hz: ${integratedLufs([s, s], rate)}`);
  }
  const m = sine(997, 5, 48000, 0.1);
  assert.ok(Math.abs(integratedLufs([m], 48000) - -23.01) < 0.1, "mono reads 3 dB lower");
  assert.equal(integratedLufs([new Float32Array(48000 * 2)], 48000), -Infinity);
});

test("loudness gain: reaches the target, or stops at the peak ceiling", () => {
  assert.deepEqual(loudnessGain(-20, -6, -14, -1), { gainDb: 5, measured: -20, result: -15, heldBack: true });
  const ok = loudnessGain(-20, -12, -14, -1);
  assert.equal(ok.gainDb, 6);
  assert.equal(ok.heldBack, false);
  const down = loudnessGain(-8, -0.1, -14, -1);
  assert.equal(down.gainDb, -6, "loud tracks come down to −14");
});

test("tools: trim silence keeps a 10 ms margin; mono; peaks; 16-bit range", () => {
  const rate = 1000;
  const c = new Float32Array(3000);
  c.fill(0.5, 1000, 2000);
  const t = trimSilence([c], rate, -60, 10);
  assert.equal(t.start, 990);
  assert.equal(t.end, 2010);
  assert.equal(t.channels[0].length, 1020);
  assert.deepEqual(Array.from(toMono([Float32Array.of(1, 0), Float32Array.of(0, 1)])[0]), [0.5, 0.5]);
  assert.ok(Math.abs(peakDb([Float32Array.of(0.5)]) - -6.02) < 0.01);
  const ints = toInt(Float32Array.of(2, -2, 0), 16);
  assert.equal(ints[0], 32767);
  assert.equal(ints[1], -32768);
  assert.ok(Math.abs(ints[2]) <= 1, "dither is at most one step");
  const g = applyGainDb([Float32Array.of(0.5)], -6.0206);
  assert.ok(Math.abs(g[0][0] - 0.25) < 1e-6);
});

test("zip: CRC-32 check value, and the entries are where the directory says", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const a = new TextEncoder().encode("hello");
  const zip = makeZip([{ name: "01 – Inspiration.mp3", data: a }, { name: "b.txt", data: Uint8Array.of(1, 2, 3) }]);
  const v = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
  const dirAt = v.getUint32(end + 16, true);
  assert.equal(v.getUint32(dirAt, true), 0x02014b50);
  assert.equal(new TextDecoder().decode(zip.subarray(30, 30 + new TextEncoder().encode("01 – Inspiration.mp3").length)), "01 – Inspiration.mp3");
});

test("names: short keys, safe file names, set-order export names", () => {
  assert.equal(shortKey("A minor"), "Am");
  assert.equal(shortKey("F# major"), "F#");
  assert.equal(shortKey("nonsense"), "");
  assert.equal(safeName('a/b:c*"d'), "a b c d");
  assert.equal(
    exportName({ track: 1, artist: "The Drift3r", title: "Inspiration", bpm: 128, camelot: "8A", ext: "mp3" }),
    "01 The Drift3r – Inspiration (128 BPM, 8A).mp3",
  );
  assert.equal(exportName({ title: "Turn It Up", ext: "wav", withInfo: false }), "Turn It Up.wav");
});

test("sniff: FLAC, M4A and unknown files", () => {
  const flac = new Uint8Array(42);
  flac.set(new TextEncoder().encode("fLaC"), 0);
  // 48000 Hz, 2 channels, 24-bit in STREAMINFO
  const sr = 48000;
  flac[18] = sr >> 12;
  flac[19] = (sr >> 4) & 0xff;
  flac[20] = ((sr & 0xf) << 4) | ((2 - 1) << 1) | ((24 - 1) >> 4);
  flac[21] = ((24 - 1) & 0xf) << 4;
  assert.deepEqual(sniff(flac), { format: "FLAC", sampleRate: 48000, channels: 2, bitDepth: 24 });
  const m4a = new Uint8Array(12);
  m4a.set(new TextEncoder().encode("ftyp"), 4);
  assert.equal(sniff(m4a).format, "M4A");
  assert.equal(sniff(new Uint8Array(10)).format, "Audio");
});

test("streamed MP3: chunks in, a valid 320 kbps file out, the right length", async () => {
  const { Mp3Stream } = await import("./mp3stream.js");
  const sr = 44100;
  const s = new Mp3Stream(sr, 320);
  for (let k = 0; k < 30; k++) {
    const l = new Float32Array(4410).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * (k * 4410 + i)) / sr));
    s.push(l, l);
  }
  s.silence(sr);
  const bytes = s.finish({ title: "Set" });
  assert.equal(String.fromCharCode(...bytes.slice(0, 3)), "ID3");
  // First MP3 frame after the tag: sync bits set.
  const tagSize = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  const f = 10 + tagSize;
  assert.equal(bytes[f], 0xff);
  assert.equal(bytes[f + 1] & 0xe0, 0xe0);
  assert.equal(s.frames, 30 * 4410 + sr);
  const seconds = s.frames / sr;
  assert.ok(Math.abs(s.bytes / ((320000 / 8) * seconds) - 1) < 0.05, `${s.bytes} bytes for ${seconds} s`);
});

test("VBR MP3 (like Suno's): the real average bit rate, not the info frame's 64 kbps", () => {
  // MPEG-1 Layer III, 48 kHz, stereo, header bit rate index 5 (64 kbps), as LAME writes the Xing frame.
  const b = new Uint8Array(4 + 32 + 16 + 400);
  b.set([0xff, 0xfb, 0x54, 0x00]); // 0x54: bit rate 64, 48 kHz
  const x = 4 + 32;
  b.set([0x58, 0x69, 0x6e, 0x67], x); // "Xing"
  const be = (v, o) => b.set([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255], o);
  be(3, x + 4); // frames + bytes present
  // 5:17 at 48 kHz = 13 208 frames of 1152 samples; 6.8 MB of audio ≈ 172 kbps.
  be(13208, x + 8);
  be(6795 * 1024, x + 12);
  const info = sniff(b);
  assert.equal(info.vbr, true);
  assert.ok(Math.abs(info.bitrate - 175) <= 3, `about 175 kbps (${info.bitrate})`);
  // "Info" = a constant bit rate file: the header's bit rate stands.
  b.set([0x49, 0x6e, 0x66, 0x6f], x);
  const cbr = sniff(b);
  assert.equal(cbr.vbr, undefined);
  assert.equal(cbr.bitrate, 64);
});
