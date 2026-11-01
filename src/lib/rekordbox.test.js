// rekordbox export tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { rekordboxXml, rekordboxKey, fileUrl, tidyFolder, gridStart, fileKind } from "./rekordbox.js";
import { camelot } from "./camelot.js";

const ENHARMONIC = { Db: 1, "C#": 1, Eb: 3, "D#": 3, "F#": 6, Gb: 6, Ab: 8, "G#": 8, Bb: 10, "A#": 10 };
const ROOTS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, ...ENHARMONIC };

test("rekordbox keys: every Camelot code gets the right key name", () => {
  for (let root = 0; root < 12; root++) {
    for (const mode of ["minor", "major"]) {
      const name = rekordboxKey(camelot(root, mode));
      const minor = name.endsWith("m");
      assert.equal(minor, mode === "minor", name);
      assert.equal(ROOTS[minor ? name.slice(0, -1) : name], root, `${camelot(root, mode)} → ${name}`);
    }
  }
  assert.equal(rekordboxKey("8a"), "Am");
  assert.equal(rekordboxKey(null), "");
});

test("locations: Windows and Mac folders, spaces and odd characters", () => {
  assert.equal(tidyFolder('"C:\\Users\\Dan\\Music\\Set\\"'), "C:/Users/Dan/Music/Set");
  assert.equal(fileUrl("C:\\Users\\Dan\\Music", "Dracula's Land.mp3"), "file://localhost/C:/Users/Dan/Music/Dracula's%20Land.mp3");
  assert.equal(fileUrl("d:\\", "a.wav"), "file://localhost/D:/a.wav");
  assert.equal(fileUrl("/Users/adalbert/Music/Rise Up/", "05 Rock & Roll #1.wav"), "file://localhost/Users/adalbert/Music/Rise%20Up/05%20Rock%20%26%20Roll%20%231.wav");
  assert.equal(fileUrl("file://localhost/Users/a/", "x.mp3"), "file://localhost/Users/a/x.mp3");
  assert.equal(fileKind("x.mp3"), "MP3 File");
  assert.equal(fileKind("x.aif"), "AIFF File");
});

test("beat grid: starts on a downbeat, moved back by whole bars", () => {
  // 128 BPM: a bar is 1.875 s. First downbeat at 15.1 → 15.1 − 8 bars = 0.1.
  assert.ok(Math.abs(gridStart(128, 15.1) - 0.1) < 1e-9);
  assert.ok(Math.abs(gridStart(128, 0.25) - 0.25) < 1e-9);
  assert.ok(Math.abs(gridStart(120, 2)) < 1e-9, "exactly one bar in → 0");
});

test("the XML file: collection, grid, cues, playlist in order, safe text", () => {
  const xml = rekordboxXml({
    folder: "C:\\Music\\Set",
    playlist: 'Dan & Adi "live"',
    version: "1.2",
    tracks: [
      { name: "Dracula's Land", fileName: "Dracula's Land.mp3", size: 9000000, duration: 245.6, bpm: 128, firstBeat: 15.1, camelot: "7A", hotCues: [32.5, null, 64.25, null] },
      { name: "Our <Mothers>", fileName: "Our Mothers.wav", size: 50000000, duration: 300, bpm: null, firstBeat: null, camelot: null, hotCues: [] },
    ],
  });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<DJ_PLAYLISTS Version="1.0.0">/);
  assert.match(xml, /<COLLECTION Entries="2">/);
  assert.match(xml, /TrackID="1" Name="Dracula's Land" Artist="" Kind="MP3 File" Size="9000000" TotalTime="246" AverageBpm="128.00" Tonality="Dm"/);
  assert.match(xml, /Location="file:\/\/localhost\/C:\/Music\/Set\/Dracula's%20Land.mp3"/);
  assert.match(xml, /<TEMPO Inizio="0.100" Bpm="128.00" Metro="4\/4" Battito="1"\/>/);
  assert.match(xml, /<POSITION_MARK Name="" Type="0" Start="15.100" Num="-1"\/>/);
  assert.match(xml, /Start="32.500" Num="0"/);
  assert.match(xml, /Start="64.250" Num="2"/);
  assert.doesNotMatch(xml, /Num="1"/);
  assert.match(xml, /Name="Our &lt;Mothers&gt;"/);
  assert.match(xml, /AverageBpm="0.00" Tonality=""/);
  // no grid for a track without a tempo
  assert.equal((xml.match(/<TEMPO /g) || []).length, 1);
  assert.match(xml, /<NODE Name="Dan &amp; Adi &quot;live&quot;" Type="1" KeyType="0" Entries="2">\n {8}<TRACK Key="1"\/>\n {8}<TRACK Key="2"\/>/);
  // every element that opens, closes
  for (const tag of ["DJ_PLAYLISTS", "COLLECTION", "PLAYLISTS"]) assert.equal(xml.split(`<${tag}`).length, xml.split(`</${tag}>`).length, tag);
});
