/**
 * Keeps the Files list and the Auto DJ playlist on this device, so a refresh
 * (or closing the tab) doesn't lose them.
 *
 * Everything stays in this browser's own storage (IndexedDB), on this device
 * only: nothing is uploaded. Each track is stored once, even when it's in
 * both lists. With the tracks go their titles, exact BPM, key shifts, what
 * was read from them (so they don't have to be read again), the Auto DJ
 * settings and the sample pads. Converted files aren't kept: they're quick to make again.
 *
 * Saving waits until the lists have been put back, so a refresh can never
 * save an empty list over the kept one. If the browser won't store anything
 * (a private window, storage full), DriftMix still works; the lists just
 * don't come back, and Files says so once.
 */
import { files, restoreItems } from "./files.js";
import { autoDj, restoreTracks } from "./autodj.js";
import { sampler, restorePads } from "./sampler.js";

const DB = "driftmix-keep";
const AUDIO = "audio"; // key → File
const LISTS = "lists"; // "files" | "autodj" → the list, without the audio

/** One name per file: the same file in both lists is stored once. */
export const keyOf = (file) => `${file.name}|${file.size}|${file.lastModified}`;

let opening = null;
function openDb() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(AUDIO);
        req.result.createObjectStore(LISTS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
  }
  return opening;
}

const asked = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });

const stored = new Set(); // audio keys in the database
let restored = false;
let broken = false;
let timer = null;
let saving = Promise.resolve();

/** The two lists as they'll be kept, and the files they need. */
function snapshot() {
  const audio = new Map();
  const need = (file) => {
    const key = keyOf(file);
    audio.set(key, file);
    return key;
  };
  const fileList = files.items
    .filter((it) => it.status !== "failed")
    .map((it) => ({
      key: need(it.file),
      title: it.title,
      targetBpm: it.targetBpm,
      semitones: it.semitones,
      info: it.info,
      analysis: it.analysis,
      found: it.found,
      duration: it.duration,
      steady: it.steady,
    }));
  const playlist = {
    tracks: autoDj.tracks
      .filter((t) => t.status !== "failed")
      .map((t) => ({ key: need(t.file), name: t.name, plan: t.plan, found: t.found, duration: t.sourceDuration })),
    settings: { tempoChoice: autoDj.tempoChoice, bars: autoDj.bars, bridge: autoDj.bridge, buildUps: autoDj.buildUps, orderBy: autoDj.orderBy },
  };
  return { fileList, playlist, audio };
}

async function save() {
  const { fileList, playlist, audio } = snapshot();
  const db = await openDb();
  // New tracks first, one per step (they're big).
  for (const [key, file] of audio) {
    if (stored.has(key)) continue;
    const tx = db.transaction(AUDIO, "readwrite");
    tx.objectStore(AUDIO).put(file, key);
    await finished(tx);
    stored.add(key);
  }
  // Then both lists, and tracks no list needs any more go.
  const tx = db.transaction([LISTS, AUDIO], "readwrite");
  tx.objectStore(LISTS).put(fileList, "files");
  tx.objectStore(LISTS).put(playlist, "autodj");
  // The pads are small: kept whole, audio and all (only when they changed).
  const padsVersion = sampler.padsVersion;
  if (padsVersion !== savedPads)
    tx.objectStore(LISTS).put(
      sampler.pads.map((p) => p && { name: p.name, title: p.title, beats: p.beats, bpm: p.bpm, camelot: p.camelot, keyName: p.keyName, cutLow: p.cutLow, sampleRate: p.sampleRate, channels: p.channels }),
      "pads",
    );
  for (const key of [...stored]) {
    if (audio.has(key)) continue;
    tx.objectStore(AUDIO).delete(key);
    stored.delete(key);
  }
  await finished(tx);
  savedPads = padsVersion;
}

let savedPads = 0;

function scheduleSave() {
  if (!restored || broken) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    saving = saving
      .then(save)
      .catch(() => {
        broken = true;
        files.message = "Couldn't keep these tracks on this device (storage is full or blocked). They work as normal; they just won't be here after a refresh.";
        files.emit();
      });
  }, 600);
}

/** Put the kept lists back, then keep them up to date. Call once at start. */
export async function startKeeping() {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no storage");
    const db = await openDb();
    const tx = db.transaction([LISTS, AUDIO], "readonly");
    const [fileList, playlist, keys, pads] = await Promise.all([
      asked(tx.objectStore(LISTS).get("files")),
      asked(tx.objectStore(LISTS).get("autodj")),
      asked(tx.objectStore(AUDIO).getAllKeys()),
      asked(tx.objectStore(LISTS).get("pads")),
    ]);
    for (const key of keys) stored.add(String(key));
    const wanted = [...new Set([...(fileList || []).map((e) => e.key), ...(playlist?.tracks || []).map((e) => e.key)])].filter((k) => stored.has(k));
    const read = db.transaction(AUDIO, "readonly");
    const got = await Promise.all(wanted.map((k) => asked(read.objectStore(AUDIO).get(k))));
    const byKey = new Map(wanted.map((k, i) => [k, got[i]]));
    const withFile = (list) => (list || []).filter((e) => byKey.get(e.key)).map((e) => ({ ...e, file: byKey.get(e.key) }));
    const backFiles = withFile(fileList);
    const backTracks = withFile(playlist?.tracks);
    if (backFiles.length) {
      restoreItems(backFiles);
      files.message = `Welcome back: your ${backFiles.length} track${backFiles.length === 1 ? " is" : "s are"} still here, with your settings.`;
      files.emit();
    }
    if (backTracks.length || playlist?.settings) restoreTracks({ tracks: backTracks, settings: playlist?.settings });
    if (pads?.some(Boolean)) {
      restorePads(pads);
      savedPads = sampler.padsVersion;
    }
    if (backTracks.length && !autoDj.message) {
      autoDj.message = `Welcome back: your playlist of ${backTracks.length} is still here.`;
      autoDj.emit();
    }
  } catch {
    broken = true; // no storage here: DriftMix works as before, without keeping
  }
  restored = true;
  files.subscribe(scheduleSave);
  autoDj.subscribe(scheduleSave);
  sampler.subscribe(() => sampler.padsVersion !== savedPads && scheduleSave());
  scheduleSave();
  // Ask the browser not to clear the kept tracks when space runs low.
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* fine */
  }
}

/** For the tests: wait for any save in progress. */
export function settled() {
  if (!restored || broken) return saving;
  clearTimeout(timer);
  return (saving = saving.then(save).catch(() => {}));
}
