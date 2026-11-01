/**
 * "Export for rekordbox": the Auto DJ playlist as a rekordbox XML file, with
 * the tempo, beat grid, key and hot cues DriftMix found for each track (see
 * lib/rekordbox.js). The folder and playlist name are remembered on this
 * device.
 *
 * rekordbox plays the original files, so the readings are the files' own:
 * a track whose tempo or key was changed in Files goes over as the file is
 * (convert it in Files first to keep the change). Nothing is uploaded.
 */
import { autoDj } from "./autodj.js";
import { savedCues } from "./engine.js";
import { app } from "./app.js";
import { cueKey } from "../lib/cues.js";
import { rekordboxXml, tidyFolder } from "../lib/rekordbox.js";
import { safeName } from "../lib/files/naming.js";

const SAVED = "driftmix.rekordbox.v1";

function load() {
  try {
    return { folder: "", playlist: "DriftMix set", ...JSON.parse(localStorage.getItem(SAVED) || "{}") };
  } catch {
    return { folder: "", playlist: "DriftMix set" };
  }
}

export const rekordbox = {
  ...load(),
  message: "",
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
    localStorage.setItem(SAVED, JSON.stringify({ folder: rekordbox.folder, playlist: rekordbox.playlist }));
  } catch {
    /* not remembered: fine */
  }
}

export function setFolder(folder) {
  rekordbox.folder = folder;
  save();
  rekordbox.emit();
}

export function setPlaylistName(name) {
  rekordbox.playlist = name;
  save();
  rekordbox.emit();
}

/** What would go into the file right now, and what to tell the DJ about it. */
export function exportPlan() {
  const ready = autoDj.tracks.filter((t) => t.status === "ready");
  const tracks = ready.map((t) => {
    const tempo = t.found?.tempo ?? null;
    const key = t.found?.key ?? null;
    return {
      name: t.name,
      fileName: t.file.name,
      size: t.file.size,
      duration: t.sourceDuration,
      bpm: tempo?.bpm ?? null,
      firstBeat: tempo?.firstBeat ?? null,
      camelot: key?.camelot ?? null,
      hotCues: savedCues(cueKey(t.file.name.replace(/\.[^.]+$/, ""), t.sourceDuration)),
      changed: Boolean(t.plan && (t.plan.tempo !== 1 || t.plan.semitones !== 0)),
    };
  });
  return {
    tracks,
    notReady: autoDj.tracks.length - ready.length,
    changed: tracks.filter((t) => t.changed).length,
    noTempo: tracks.filter((t) => !t.bpm).length,
    cues: tracks.reduce((n, t) => n + t.hotCues.filter((c) => c !== null).length, 0),
  };
}

/** Make the file and download it. */
export function exportRekordbox() {
  const plan = exportPlan();
  const folder = tidyFolder(rekordbox.folder);
  if (!plan.tracks.length) return say("Add some tracks to the playlist first.");
  if (!folder) return say("Type the folder your tracks are in first (copy it from the address bar of File Explorer or Finder).");
  const xml = rekordboxXml({ tracks: plan.tracks, folder, playlist: rekordbox.playlist.trim() || "DriftMix set", version: app.version });
  const name = `${safeName(rekordbox.playlist) || "DriftMix set"} (rekordbox).xml`;
  const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const notes = [];
  if (plan.notReady) notes.push(`${plan.notReady} still reading or unreadable, left out`);
  if (plan.changed) notes.push(`${plan.changed} with a tempo or key change go over as the original file`);
  if (plan.noTempo) notes.push(`${plan.noTempo} without a tempo: rekordbox will read those itself`);
  say(
    `Saved ${name}: ${plan.tracks.length} track${plan.tracks.length === 1 ? "" : "s"}, ${plan.cues} hot cue${plan.cues === 1 ? "" : "s"}.` +
      (notes.length ? ` ${notes.join("; ")}.` : ""),
  );
  return xml;
}

function say(message) {
  rekordbox.message = message;
  rekordbox.emit();
}
