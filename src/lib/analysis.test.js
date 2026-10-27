// Tempo and key tests. Run with: npm test
// The test tracks are made on the fly by test-synth.js (kick, clap, hats,
// bass and chords), so we know the right answers exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { camelot, keyName, parseCamelot } from "./camelot.js";
import { detectTempo } from "./tempo.js";
import { detectKey, rankKeys, keyFromChroma } from "./key.js";
import { analyzeTrack, downsample, judge } from "./analyze.js";
import { synthTrack } from "./test-synth.js";

const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function at22k(track) {
  return downsample(track.samples, track.sampleRate);
}

test("Camelot codes match the wheel DJs use", () => {
  const expected = {
    "D minor": "7A", "A minor": "8A", "E minor": "9A", "B minor": "10A", "F# minor": "11A", "C# minor": "12A",
    "Ab minor": "1A", "Eb minor": "2A", "Bb minor": "3A", "F minor": "4A", "C minor": "5A", "G minor": "6A",
    "F major": "7B", "C major": "8B", "G major": "9B", "D major": "10B", "A major": "11B", "E major": "12B",
    "B major": "1B", "F# major": "2B", "C# major": "3B", "Ab major": "4B", "Eb major": "5B", "Bb major": "6B",
  };
  for (let root = 0; root < 12; root++) {
    for (const mode of ["major", "minor"]) {
      assert.equal(camelot(root, mode), expected[keyName(root, mode)], keyName(root, mode));
    }
  }
  assert.equal(new Set(Object.values(expected)).size, 24);
  assert.deepEqual(parseCamelot("7a"), { number: 7, letter: "A" });
  assert.deepEqual(parseCamelot("12B"), { number: 12, letter: "B" });
  assert.equal(parseCamelot("13A"), null);
});

test("tempo: exact BPM for dance tempos, including Adalbert's 124, 128, 130 and 133", () => {
  for (const bpm of [118, 124, 126, 128, 130, 133, 138, 140, 145, 150]) {
    const t = at22k(synthTrack({ bpm, seconds: 30, seed: bpm }));
    const r = detectTempo(t.samples, t.sampleRate);
    assert.equal(r.bpm, bpm, `${bpm} BPM`);
  }
});

test("tempo: drums only, and a slow 100 BPM track, still read right (not half or double)", () => {
  for (const [bpm, drumsOnly] of [[128, true], [100, false], [174, true]]) {
    const t = at22k(synthTrack({ bpm, drumsOnly, seconds: 30 }));
    assert.equal(detectTempo(t.samples, t.sampleRate).bpm, bpm, `${bpm}${drumsOnly ? " drums only" : ""}`);
  }
});

test("tempo: finds where the beat lands to within 15 ms", () => {
  for (const [bpm, lead] of [[128, 0], [124, 0.3], [133, 0.123]]) {
    const t = at22k(synthTrack({ bpm, lead, seconds: 30 }));
    const r = detectTempo(t.samples, t.sampleRate);
    const beat = 60 / bpm;
    let error = Math.abs(r.firstBeat - (lead % beat));
    error = Math.min(error, beat - error);
    assert.ok(error < 0.015, `${bpm} BPM, first beat at ${lead}s: off by ${(error * 1000).toFixed(1)} ms`);
  }
});

test("tempo: no answer for silence or a clip too short to tell", () => {
  assert.equal(detectTempo(new Float32Array(22050 * 20), 22050), null);
  const short = at22k(synthTrack({ bpm: 128, seconds: 2 }));
  assert.equal(detectTempo(short.samples, short.sampleRate), null);
});

test("key: Adalbert's test key, D minor, reads 7A", () => {
  const t = at22k(synthTrack({ bpm: 133, root: 2, mode: "minor", seconds: 30 }));
  const k = detectKey(t.samples, t.sampleRate);
  assert.equal(k.camelot, "7A");
  assert.equal(k.name, "D minor");
});

test("key: at least 22 of 24 keys exactly right, and any miss is still a Camelot neighbour", () => {
  let right = 0;
  for (let root = 0; root < 12; root++) {
    for (const mode of ["minor", "major"]) {
      const t = at22k(synthTrack({ bpm: 128, root, mode, seconds: 20, seed: root + 1 }));
      const k = detectKey(t.samples, t.sampleRate);
      const want = parseCamelot(camelot(root, mode));
      const got = parseCamelot(k.camelot);
      if (got.number === want.number && got.letter === want.letter) {
        right++;
        continue;
      }
      // Same number (relative major/minor) or one step round the wheel.
      const steps = Math.min((got.number - want.number + 12) % 12, (want.number - got.number + 12) % 12);
      assert.ok(steps === 0 || (steps === 1 && got.letter === want.letter), `${NOTES[root]} ${mode} read as ${k.name}`);
    }
  }
  assert.ok(right >= 22, `${right} of 24 right`);
});

test("analysis says 'not found' rather than guessing on noise", () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const noise = new Float32Array(44100 * 20).map(rnd);
  const r = analyzeTrack(noise, 44100);
  assert.equal(r.tempo, null);
  assert.equal(r.key, null);
});

test("analysis of a full 44.1 kHz track gives tempo, key and beat position", () => {
  const t = synthTrack({ bpm: 133, root: 2, mode: "minor", seconds: 30, sampleRate: 44100 });
  const r = analyzeTrack(t.samples, t.sampleRate);
  assert.equal(r.tempo.bpm, 133);
  assert.equal(r.tempo.sure, true);
  assert.equal(r.key.camelot, "7A");
  assert.equal(r.key.sure, true);
  assert.ok(r.seconds < 10);
});

test("downsample halves 44.1 kHz and leaves 22.05 kHz alone", () => {
  const d = downsample(new Float32Array([1, 3, 5, 7, 9]), 44100);
  assert.equal(d.sampleRate, 22050);
  assert.deepEqual(Array.from(d.samples), [2, 6]);
  const same = new Float32Array([1, 2]);
  assert.equal(downsample(same, 22050).samples, same);
});

test("judge: weak answers hidden, middling marked unsure, strong marked sure", () => {
  assert.equal(judge(null), null);
  assert.equal(judge({ confidence: 0.1 }), null);
  assert.equal(judge({ confidence: 0.45 }).sure, false);
  assert.equal(judge({ confidence: 0.9 }).sure, true);
});

test("downbeat: finds bar one even when a track starts mid-bar", async () => {
  const { findDownbeat } = await import("./downbeat.js");
  for (const cutBeats of [0, 1, 2, 3]) {
    const bpm = 128;
    const t = synthTrack({ bpm, root: 9, mode: "minor", seconds: 40, lead: 0.1 });
    const cut = Math.round((0.1 + (cutBeats * 60) / bpm - 0.05) * t.sampleRate);
    const d = downsample(t.samples.subarray(cut), t.sampleRate);
    const tempo = detectTempo(d.samples, d.sampleRate);
    const r = findDownbeat(d.samples, d.sampleRate, tempo.bpm, tempo.firstBeat);
    assert.equal(r.offset, (4 - cutBeats) % 4, `cut ${cutBeats} beats`);
    assert.equal(r.sure, true);
  }
});

test("local grid: re-measures a drifting tempo to ±0.03 BPM and the beat to ±5 ms", async () => {
  const { fitLocalGrid } = await import("./tempo.js");
  for (const [bpm, lead, rough] of [[129.71, 0.137, 129.6], [130.9, 0.05, 131], [128, 0.3, 128.4]]) {
    const t = synthTrack({ bpm, lead, seconds: 40 });
    const d = downsample(t.samples, t.sampleRate);
    const from = 7.3;
    const slice = d.samples.subarray(Math.round(from * d.sampleRate), Math.round((from + 30) * d.sampleRate));
    const r = fitLocalGrid(slice, d.sampleRate, rough);
    assert.ok(Math.abs(r.bpm - bpm) < 0.03, `${bpm}: measured ${r.bpm.toFixed(3)}`);
    const beat = 60 / bpm;
    let e = Math.abs(r.beat - ((((lead - from) % beat) + beat) % beat));
    e = Math.min(e, beat - e);
    assert.ok(e < 0.005, `${bpm}: beat off by ${(e * 1000).toFixed(1)} ms`);
  }
});

test("key: a close call between keys that don't mix is marked unsure, with the other option", () => {
  // Notes like Adalbert's "Vortex of Your Music": F# and C# strong, the third
  // (A for minor, A# for major) almost level, so major vs minor is a coin toss.
  const N = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  const chroma = new Float64Array(12);
  for (const [n, v] of Object.entries({ "F#": 1, "C#": 0.8, A: 0.51, B: 0.51, "A#": 0.5, "G#": 0.48, D: 0.41, E: 0.4, "D#": 0.37, F: 0.33, C: 0.32, G: 0.31 })) chroma[N[n]] = v;
  const [first, second] = rankKeys(chroma);
  assert.equal(second.root, first.root, "runner-up: same root, other mode");
  const k = keyFromChroma(chroma);
  assert.equal(k.camelot, "2B");
  assert.ok(k.confidence < 0.6, "not sure");
  assert.equal(k.alt.camelot, "11A");
  // A clear F# minor (A well above A#) is sure, with no alternative.
  chroma[N.A] = 0.9;
  chroma[N["A#"]] = 0.2;
  const clear = keyFromChroma(chroma);
  assert.equal(clear.camelot, "11A");
  assert.equal(clear.alt, null);
  assert.ok(clear.confidence >= 0.6);
});

test("key: clean tracks in all 24 keys stay sure (no false close calls)", () => {
  for (let root = 0; root < 12; root += 1) {
    for (const mode of ["major", "minor"]) {
      const t = synthTrack({ bpm: 128, root, mode, seconds: 20, bright: root % 2 === 1, seed: root + 3 });
      const d = downsample(t.samples, t.sampleRate);
      const k = detectKey(d.samples, d.sampleRate);
      assert.ok(k.confidence >= 0.6, `${keyName(root, mode)}: ${k.camelot} ${k.confidence.toFixed(2)} alt ${k.alt?.camelot}`);
    }
  }
});
