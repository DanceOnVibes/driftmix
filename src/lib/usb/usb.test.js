// "Check my USB" tests: the stick's track list, analysis files and the report. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readLibrary, readString } from "./pdb.js";
import { buildPdb } from "./pdbBuild.js";
import { readAnlz } from "./anlz.js";
import { usbReport, stickPath } from "./report.js";

const stick = () =>
  buildPdb({
    artists: [{ id: 1, name: "The Drift3r" }],
    albums: [{ id: 3, name: "Rise Up" }],
    genres: [{ id: 2, name: "Progressive House" }],
    keys: [
      { id: 1, name: "Am" },
      { id: 2, name: "Bbm" },
    ],
    tracks: [
      { id: 1, title: "Our Mothers", artistId: 1, albumId: 3, genreId: 2, keyId: 2, bpm: 136.36, seconds: 255, filePath: "/Contents/The Drift3r/Rise Up/Our Mothers.wav", fileName: "Our Mothers.wav", analyzePath: "/PIONEER/USBANLZ/P001/00000001/ANLZ0000.DAT", fileSize: 45000000 },
      { id: 2, title: "Pământ Românesc", artistId: 1, keyId: 1, bpm: 130.06, seconds: 301, filePath: "/Contents/The Drift3r/Romania Mea/Pământ Românesc.wav", fileName: "Pământ Românesc.wav", analyzePath: "/PIONEER/USBANLZ/P002/00000002/ANLZ0000.DAT" },
      { id: 3, title: "Dracula's Land", artistId: 1, keyId: 0, bpm: 0, seconds: 245, filePath: "/Contents/The Drift3r/Dracula's Land.wav", fileName: "Dracula's Land.wav", analyzePath: "/PIONEER/USBANLZ/P003/00000003/ANLZ0000.DAT" },
    ],
    playlists: [
      { id: 10, name: "Dan Night", trackIds: [2, 1, 3] },
      { id: 11, name: "Empty one", trackIds: [] },
    ],
  });

/** An analysis file with a path, a beat grid of `beats` beats and a waveform. */
function anlz({ path = "/Contents/x.wav", beats = 4, bpm = 128, waveform = true } = {}) {
  const tags = [];
  const pathBytes = new Uint8Array((path.length + 1) * 2);
  for (let i = 0; i < path.length; i++) pathBytes[i * 2 + 1] = path.charCodeAt(i);
  const tag = (name, headerLen, body) => {
    const b = new Uint8Array(12 + body.length);
    const v = new DataView(b.buffer);
    for (let i = 0; i < 4; i++) b[i] = name.charCodeAt(i);
    v.setUint32(4, headerLen, false);
    v.setUint32(8, b.length, false);
    b.set(body, 12);
    return b;
  };
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, pathBytes.length, false);
  tags.push(tag("PPTH", 16, new Uint8Array([...len, ...pathBytes])));
  const grid = new Uint8Array(12 + beats * 8);
  const g = new DataView(grid.buffer);
  g.setUint32(4, 0x80000, false);
  g.setUint32(8, beats, false);
  for (let i = 0; i < beats; i++) {
    g.setUint16(12 + i * 8, (i % 4) + 1, false);
    g.setUint16(14 + i * 8, bpm * 100, false);
    g.setUint32(16 + i * 8, Math.round((i * 60000) / bpm), false);
  }
  tags.push(tag("PQTZ", 24, grid));
  if (waveform) tags.push(tag("PWAV", 20, new Uint8Array(408)));
  const head = new Uint8Array(28);
  const h = new DataView(head.buffer);
  head.set([80, 77, 65, 73]);
  h.setUint32(4, 28, false);
  const total = head.length + tags.reduce((n, t) => n + t.length, 0);
  h.setUint32(8, total, false);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [head, ...tags]) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

test("track list: titles (Romanian letters too), artist, album, key, BPM, paths", () => {
  const lib = readLibrary(stick());
  assert.equal(lib.tracks.length, 3);
  const [a, b, c] = lib.tracks;
  assert.deepEqual(
    { title: a.title, artist: a.artist, album: a.album, genre: a.genre, key: a.key, bpm: a.bpm, seconds: a.seconds, size: a.fileSize },
    { title: "Our Mothers", artist: "The Drift3r", album: "Rise Up", genre: "Progressive House", key: "Bbm", bpm: 136.36, seconds: 255, size: 45000000 },
  );
  assert.equal(b.title, "Pământ Românesc");
  assert.equal(b.filePath, "/Contents/The Drift3r/Romania Mea/Pământ Românesc.wav");
  assert.equal(b.key, "Am");
  assert.equal(c.key, "");
  assert.equal(c.bpm, 0);
});

test("playlists keep their order", () => {
  const lib = readLibrary(stick());
  assert.deepEqual(
    lib.playlists.map((p) => [p.name, p.trackIds]),
    [
      ["Dan Night", [2, 1, 3]],
      ["Empty one", []],
    ],
  );
});

test("not a track list: a clear error, not a crash", () => {
  assert.throws(() => readLibrary(new ArrayBuffer(10)), /Too short/);
  assert.throws(() => readLibrary(new Uint8Array(8192).buffer), /Not a rekordbox database/);
});

test("strings: short, long ASCII and UTF-16", () => {
  const b = new Uint8Array([0x0d, 72, 101, 108, 108, 111, 0x40, 9, 0, 0, 65, 66, 67, 68, 69, 0x90, 8, 0, 0, 0x03, 0x01, 0x6e, 0x00]);
  const v = new DataView(b.buffer);
  assert.equal(readString(v, 0), "Hello");
  assert.equal(readString(v, 6), "ABCDE");
  assert.equal(readString(v, 15), "ăn");
});

test("analysis file: path, beat grid and waveform", () => {
  const r = readAnlz(anlz({ path: "/Contents/Our Mothers.wav", beats: 8, bpm: 136.36 }));
  assert.equal(r.ok, true);
  assert.equal(r.path, "/Contents/Our Mothers.wav");
  assert.equal(r.beats, 8);
  assert.equal(r.bpm, 136.36);
  assert.equal(r.waveform, true);
  assert.equal(readAnlz(anlz({ beats: 0, waveform: false })).beats, 0);
  assert.equal(readAnlz(new ArrayBuffer(40)).ok, false);
});

test("report: ready, problems found, empty and no list", () => {
  const library = readLibrary(stick());
  const files = [
    "Contents/The Drift3r/Rise Up/Our Mothers.wav",
    "Contents/The Drift3r/Romania Mea/Pământ Românesc.wav",
    "My Music/loose track.wav",
    "PIONEER/rekordbox/export.pdb",
  ];
  const analysis = new Map([
    [stickPath("/PIONEER/USBANLZ/P001/00000001/ANLZ0000.DAT"), readAnlz(anlz())],
    [stickPath("/PIONEER/USBANLZ/P002/00000002/ANLZ0000.DAT"), readAnlz(anlz())],
  ]);
  const r = usbReport({ library, files, analysis, oneLibrary: true, wholeStick: true });
  assert.equal(r.verdict, "problems");
  assert.equal(r.playlists[0].name, "Dan Night");
  assert.deepEqual(
    r.playlists[0].tracks.map((t) => t.title),
    ["Pământ Românesc", "Our Mothers", "Dracula's Land"],
  );
  const all = r.problems.join(" | ");
  assert.match(all, /1 track is in the list but the music file is missing.*Dracula's Land/);
  assert.match(all, /1 track has no waveform or beat grid.*Dracula's Land/);
  assert.match(all, /1 track has no key/);
  assert.match(all, /1 playlist is empty: Empty one/);
  assert.match(all, /1 music file on the stick isn't in the track list/);
  assert.equal(r.loose, 1);
  assert.equal(r.oneLibrary, true);

  // fix everything: ready
  const good = readLibrary(
    buildPdb({
      keys: [{ id: 1, name: "Am" }],
      tracks: [{ id: 1, title: "A", keyId: 1, bpm: 128, filePath: "/Contents/A.wav", analyzePath: "/PIONEER/USBANLZ/P1/1/ANLZ0000.DAT" }],
      playlists: [{ id: 1, name: "Set", trackIds: [1] }],
    }),
  );
  const ok = usbReport({ library: good, files: ["Contents/A.wav"], analysis: new Map([[stickPath("/PIONEER/USBANLZ/P1/1/ANLZ0000.DAT"), readAnlz(anlz())]]), oneLibrary: false, wholeStick: true });
  assert.equal(ok.verdict, "ready");
  assert.match(ok.headline, /Ready for the decks: 1 track in 1 playlist/);

  const empty = usbReport({ library: readLibrary(buildPdb({})), files: [], analysis: new Map(), oneLibrary: true, wholeStick: true });
  assert.equal(empty.verdict, "empty");
  const none = usbReport({ library: null, files: ["My Music/a.wav", "My Music/b.mp3"], analysis: new Map(), oneLibrary: false, wholeStick: true });
  assert.equal(none.verdict, "none");
  assert.equal(none.loose, 2);
});

test("only the PIONEER folder picked: no false 'missing music' alarms", () => {
  const library = readLibrary(stick());
  const r = usbReport({ library, files: ["PIONEER/rekordbox/export.pdb"], analysis: new Map(), oneLibrary: false, wholeStick: false });
  assert.doesNotMatch(r.problems.join(" "), /music file is missing/);
  assert.equal(r.tracks[0].audio, null);
});
