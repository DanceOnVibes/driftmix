/**
 * The Files section: convert, tag and tidy tracks, all on this device.
 *
 * Add → each file is looked at (format, sample rate) and read for BPM and
 * key, then let go to save memory. Convert → one at a time: decode at the
 * target sample rate (the browser's own high-quality resampler), then the
 * worker trims, levels and encodes, with the tags written in.
 */
import { analyzeBuffer } from "./analysis.js";
import { sniff } from "../lib/files/sniff.js";
import { MP3_RATES } from "../lib/files/mp3.js";
import { makeZip } from "../lib/files/zip.js";
import { exportName, shortKey, safeName } from "../lib/files/naming.js";

const AUDIO_NAME = /\.(mp3|wav|flac|aiff?|m4a|aac|ogg|opus)$/i;
const SAVED = "driftmix.files.v1";

const defaults = {
  settings: {
    format: "mp3", // mp3 | wav
    bitrate: 320,
    bitDepth: 16,
    sampleRate: "original", // original | 44100 | 48000
    channels: "stereo", // stereo | mono
    loudness: "off", // off | -14 | -9
    trim: true,
    numbering: true,
    infoInName: true,
  },
  common: { artist: "", album: "", year: String(new Date().getFullYear()), genre: "", copyright: "All rights reserved", comment: "" },
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) || "null");
    if (saved) return { settings: { ...defaults.settings, ...saved.settings }, common: { ...defaults.common, ...saved.common } };
  } catch {
    /* private window etc.: use defaults */
  }
  return structuredClone(defaults);
}

const start = load();

export const files = {
  /** @type {any[]} */
  items: [],
  settings: start.settings,
  common: start.common,
  cover: null, // { bytes, mime, url }
  busy: false,
  message: "",
  zipUrl: null,
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

function save() {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ settings: files.settings, common: files.common }));
  } catch {
    /* not saved: fine */
  }
}

export function setSetting(key, value) {
  files.settings = { ...files.settings, [key]: value };
  save();
  staleOutputs();
}

export function setCommon(key, value) {
  files.common = { ...files.common, [key]: value };
  save();
  staleOutputs();
}

/** Settings changed: finished files no longer match, so convert again. */
function staleOutputs() {
  for (const it of files.items) if (it.status === "done") clearOutput(it, "ready");
  clearZip();
  files.emit();
}

function clearOutput(it, status) {
  if (it.output?.url) URL.revokeObjectURL(it.output.url);
  it.output = null;
  it.status = status;
}

function clearZip() {
  if (files.zipUrl) URL.revokeObjectURL(files.zipUrl);
  files.zipUrl = null;
}

/** "Vortex of Your Music_222003103_225237910" → "Vortex of Your Music". */
export function cleanTitle(fileName) {
  return safeName(
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/([_ -]\d{6,})+$/g, "")
      .replace(/[_]+/g, " "),
  );
}

// ---- adding --------------------------------------------------------------

let nextId = 1;
let reading = Promise.resolve();

export function addFiles(list) {
  const picked = [...list].filter((f) => f.type.startsWith("audio/") || AUDIO_NAME.test(f.name));
  for (const file of picked) {
    const it = { id: String(nextId++), file, title: cleanTitle(file.name), status: "reading", info: null, analysis: null, duration: 0, output: null, progress: 0, note: "" };
    files.items.push(it);
    reading = reading.then(() => inspect(it));
  }
  clearZip();
  files.emit();
  return picked.length;
}

async function inspect(it) {
  if (!files.items.includes(it)) return;
  try {
    const bytes = await it.file.arrayBuffer();
    it.info = sniff(new Uint8Array(bytes));
    const rate = it.info.sampleRate || 44100;
    const ctx = new OfflineAudioContext(2, 1, rate);
    const buffer = await ctx.decodeAudioData(bytes);
    it.duration = buffer.duration;
    if (!it.info.channels) it.info.channels = buffer.numberOfChannels;
    if (!it.info.sampleRate) it.info.sampleRate = buffer.sampleRate;
    const result = await analyzeBuffer(buffer);
    it.analysis = {
      bpm: result.tempo?.bpm ?? null,
      bpmSure: Boolean(result.tempo?.sure),
      camelot: result.key?.camelot ?? null,
      keyName: result.key?.name ?? null,
      keySure: Boolean(result.key?.sure),
      keyAlt: result.key?.alt?.camelot ?? null,
    };
    it.status = "ready";
  } catch {
    it.status = "failed";
    it.note = "This file couldn't be read.";
  }
  files.emit();
}

/**
 * The Files list, ready to hand to Auto DJ: the original files (best sound,
 * no extra encoding), in list order, with the titles as edited here.
 * @returns {{ file: File, name: string }[]}
 */
export function filesForAutoDj() {
  return files.items.filter((it) => it.status !== "failed").map((it) => ({ file: it.file, name: it.title || cleanTitle(it.file.name) }));
}

export function removeItem(id) {
  const it = files.items.find((x) => x.id === id);
  if (!it || files.busy) return;
  clearOutput(it, it.status);
  files.items = files.items.filter((x) => x !== it);
  clearZip();
  files.emit();
}

export function moveItem(id, step) {
  const list = files.items;
  const i = list.findIndex((x) => x.id === id);
  const j = i + step;
  if (files.busy || i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  staleOutputs();
}

export function setTitle(id, title) {
  const it = files.items.find((x) => x.id === id);
  if (!it) return;
  it.title = title;
  if (it.status === "done") clearOutput(it, "ready");
  clearZip();
  files.emit();
}

export function clearAll() {
  if (files.busy) return;
  for (const it of files.items) clearOutput(it, it.status);
  files.items = [];
  clearZip();
  files.message = "";
  files.emit();
}

/** A cover image, resized to at most 1000 px and saved as JPEG (keeps files small). */
export async function setCover(file) {
  if (!file) {
    if (files.cover?.url) URL.revokeObjectURL(files.cover.url);
    files.cover = null;
    staleOutputs();
    return;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (files.cover?.url) URL.revokeObjectURL(files.cover.url);
  files.cover = { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg", url: URL.createObjectURL(blob) };
  staleOutputs();
}

// ---- converting ----------------------------------------------------------

let worker = null;
let jobId = 1;
const waiting = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./files.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, progress, result, error } = event.data;
      const job = waiting.get(id);
      if (!job) return;
      if (progress !== undefined) return job.onProgress?.(progress);
      waiting.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    };
    worker.onerror = (event) => {
      for (const job of waiting.values()) job.reject(new Error(event.message || "Conversion failed"));
      waiting.clear();
      worker.terminate();
      worker = null;
    };
  }
  return worker;
}

/** The sample rate a file will come out at (MP3 can't do every rate). */
export function targetRate(it, settings = files.settings) {
  let rate = settings.sampleRate === "original" ? it.info?.sampleRate || 44100 : Number(settings.sampleRate);
  if (settings.format === "mp3" && !MP3_RATES.includes(rate)) rate = rate > 44100 ? 48000 : 44100;
  return rate;
}

/** The tags written into a file. */
export function tagsFor(it, index) {
  const c = files.common;
  const a = it.analysis || {};
  const comment = [a.camelot, c.comment].filter(Boolean).join(" · ");
  return {
    title: it.title,
    artist: c.artist,
    albumArtist: c.artist,
    album: c.album,
    track: files.settings.numbering ? index + 1 : undefined,
    year: c.year,
    genre: c.genre,
    bpm: a.bpm ? Math.round(a.bpm) : undefined,
    key: shortKey(a.keyName),
    comment,
    copyright: c.copyright,
    cover: files.cover ? { mime: files.cover.mime, bytes: files.cover.bytes.slice() } : undefined,
  };
}

export function nameFor(it, index) {
  const s = files.settings;
  return exportName({
    track: s.numbering ? index + 1 : undefined,
    artist: files.common.artist,
    title: it.title || "Untitled",
    bpm: it.analysis?.bpm,
    camelot: it.analysis?.camelot,
    ext: s.format === "mp3" ? "mp3" : "wav",
    withInfo: s.infoInName,
  });
}

export async function convertAll() {
  if (files.busy) return;
  const todo = files.items.filter((it) => it.status === "ready" || it.status === "error");
  if (!todo.length) return;
  files.busy = true;
  files.message = "";
  clearZip();
  files.emit();
  let done = 0;
  for (const it of todo) {
    const index = files.items.indexOf(it);
    it.status = "converting";
    it.progress = 0;
    it.note = "";
    files.emit();
    try {
      const rate = targetRate(it);
      const ctx = new OfflineAudioContext(2, 1, rate);
      const decoded = await ctx.decodeAudioData(await it.file.arrayBuffer());
      const channels = [decoded.getChannelData(0).slice()];
      channels.push(decoded.numberOfChannels > 1 ? decoded.getChannelData(1).slice() : channels[0].slice());
      it.progress = 0.1;
      files.emit();
      const settings = { ...files.settings };
      const id = jobId++;
      const result = await new Promise((resolve, reject) => {
        waiting.set(id, {
          resolve,
          reject,
          onProgress: (f) => {
            it.progress = 0.1 + 0.9 * f;
            files.emit();
          },
        });
        getWorker().postMessage({ id, channels, sampleRate: rate, settings, tags: tagsFor(it, index) }, channels.map((c) => c.buffer));
      });
      const type = settings.format === "mp3" ? "audio/mpeg" : "audio/wav";
      const blob = new Blob([result.bytes], { type });
      it.output = { blob, url: URL.createObjectURL(blob), name: nameFor(it, index), size: blob.size, rate, loudness: result.loudness, trimmed: result.trimmed };
      it.status = "done";
      it.progress = 1;
      const notes = [];
      if (result.loudness) notes.push(`${fmtLufs(result.loudness.result)} LUFS${result.loudness.heldBack ? " (peaks kept safe, so a little under)" : ""}`);
      if (result.trimmed > 0.05) notes.push(`trimmed ${result.trimmed.toFixed(1)} s of silence`);
      if (settings.sampleRate === "original" && settings.format === "mp3" && rate !== it.info?.sampleRate) notes.push(`${rate / 1000} kHz (MP3 can't do ${it.info?.sampleRate / 1000} kHz)`);
      it.note = notes.join(" · ");
      done++;
    } catch (error) {
      it.status = "error";
      it.note = `Couldn't convert: ${error.message || error}`;
    }
    files.emit();
  }
  files.busy = false;
  files.message = `${done} of ${todo.length} converted.`;
  files.emit();
}

function fmtLufs(x) {
  return Number.isFinite(x) ? x.toFixed(1) : "–";
}

/** All finished files in one zip ("Download all"). */
export async function buildZip() {
  const done = files.items.filter((it) => it.status === "done");
  if (!done.length) return null;
  clearZip();
  const entries = [];
  for (const it of done) entries.push({ name: it.output.name, data: new Uint8Array(await it.output.blob.arrayBuffer()) });
  const blob = new Blob([makeZip(entries)], { type: "application/zip" });
  files.zipUrl = URL.createObjectURL(blob);
  files.emit();
  return { url: files.zipUrl, name: `${safeName(files.common.album || "DriftMix files")}.zip` };
}

/** Phone sharing (WhatsApp, Drive, Files…), where the browser supports it. */
export function canShareFiles() {
  try {
    return Boolean(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], "t.mp3", { type: "audio/mpeg" })] }));
  } catch {
    return false;
  }
}

export async function shareDone() {
  const done = files.items.filter((it) => it.status === "done");
  const list = done.map((it) => new File([it.output.blob], it.output.name, { type: it.output.blob.type }));
  if (!list.length) return;
  try {
    await navigator.share({ files: list, title: files.common.album || "Tracks" });
  } catch {
    /* cancelled */
  }
}
