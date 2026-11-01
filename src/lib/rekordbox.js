/**
 * rekordbox export: a DriftMix playlist as a rekordbox XML file (the open
 * format rekordbox itself reads and writes, documented by Pioneer DJ / AlphaTheta).
 * rekordbox imports it with the tempo, beat grid, key and hot cues DriftMix
 * found, then puts the playlist on a USB stick for CDJs/XDJs (Export mode,
 * part of rekordbox's free plan).
 *
 * A web page can't see where a file sits on the computer, so the DJ types
 * the folder once; each track's location is that folder plus its file name.
 * Tracks that sit somewhere else show as missing in rekordbox and can be
 * pointed to with its Relocate option.
 *
 * Plain text in, plain text out: tested without a browser.
 */

/** Camelot → the key the way rekordbox writes it (classic notation). */
const KEYS = {
  "1A": "Abm", "2A": "Ebm", "3A": "Bbm", "4A": "Fm", "5A": "Cm", "6A": "Gm",
  "7A": "Dm", "8A": "Am", "9A": "Em", "10A": "Bm", "11A": "F#m", "12A": "Dbm",
  "1B": "B", "2B": "F#", "3B": "Db", "4B": "Ab", "5B": "Eb", "6B": "Bb",
  "7B": "F", "8B": "C", "9B": "G", "10B": "D", "11B": "A", "12B": "E",
}; // prettier-ignore

export function rekordboxKey(camelot) {
  return KEYS[String(camelot || "").toUpperCase()] ?? "";
}

/** What rekordbox calls the file type. */
export function fileKind(fileName) {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toUpperCase();
  return ext ? `${ext === "AIF" ? "AIFF" : ext} File` : "";
}

/**
 * The folder as typed (Windows or Mac), tidied: forward slashes, no slash at
 * the end. "C:\Users\Dan\Music\" → "C:/Users/Dan/Music".
 */
export function tidyFolder(folder) {
  let f = String(folder || "").trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
  f = f.replace(/^file:\/\/(localhost)?/i, "");
  f = f.replace(/\/+$/, "");
  if (/^[a-z]:$/i.test(f)) f += "/"; // just a drive: keep its slash ("D:/")
  return f;
}

/** A track's location the way rekordbox wants it: file://localhost/C:/Music/My%20Track.mp3 */
export function fileUrl(folder, fileName) {
  const parts = [...tidyFolder(folder).split("/"), fileName].filter((p, i) => p !== "" || i === 0);
  const encoded = parts.map((p) => (/^[a-z]:$/i.test(p) ? p.toUpperCase() : encodeURIComponent(p))).join("/");
  return `file://localhost${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters XML can't hold at all (control codes) are dropped
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const num = (x, places) => Number(x).toFixed(places);

/**
 * The beat grid for rekordbox: it starts on the first downbeat DriftMix
 * found, moved back by whole bars to the start of the track (so the bars
 * stay where they are), beat 1 of the bar.
 */
export function gridStart(bpm, firstBeat) {
  const bar = (60 / bpm) * 4;
  const start = firstBeat - Math.floor(firstBeat / bar + 1e-9) * bar;
  return start < 0 ? 0 : start;
}

/**
 * @param {object} o
 * @param {{ name: string, fileName: string, size?: number, duration: number,
 *   bpm?: number|null, firstBeat?: number|null, camelot?: string|null,
 *   hotCues?: (number|null)[], artist?: string }[]} o.tracks  in playlist order
 * @param {string} o.folder  where the tracks are on the computer
 * @param {string} [o.playlist]  the playlist's name in rekordbox
 * @param {string} [o.version]  DriftMix's version
 * @returns {string} the XML file
 */
export function rekordboxXml({ tracks, folder, playlist = "DriftMix set", version = "" }) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">'];
  lines.push(`  <PRODUCT Name="DriftMix" Version="${esc(version)}" Company="DanceOnVibes Limited"/>`);
  lines.push(`  <COLLECTION Entries="${tracks.length}">`);
  tracks.forEach((t, i) => {
    const attrs = [
      ["TrackID", i + 1],
      ["Name", t.name],
      ["Artist", t.artist ?? ""],
      ["Kind", fileKind(t.fileName)],
      ["Size", t.size ?? 0],
      ["TotalTime", Math.round(t.duration || 0)],
      ["AverageBpm", t.bpm ? num(t.bpm, 2) : "0.00"],
      ["Tonality", rekordboxKey(t.camelot)],
      ["Comments", "Prepared in DriftMix"],
      ["Location", fileUrl(folder, t.fileName)],
    ];
    lines.push(`    <TRACK ${attrs.map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}>`);
    if (t.bpm && Number.isFinite(t.firstBeat)) {
      const start = gridStart(t.bpm, t.firstBeat);
      lines.push(`      <TEMPO Inizio="${num(start, 3)}" Bpm="${num(t.bpm, 2)}" Metro="4/4" Battito="1"/>`);
      // A memory cue on the first downbeat, like rekordbox's own.
      lines.push(`      <POSITION_MARK Name="" Type="0" Start="${num(t.firstBeat, 3)}" Num="-1"/>`);
    }
    (t.hotCues || []).forEach((at, n) => {
      if (typeof at === "number" && at >= 0) lines.push(`      <POSITION_MARK Name="" Type="0" Start="${num(at, 3)}" Num="${n}"/>`);
    });
    lines.push("    </TRACK>");
  });
  lines.push("  </COLLECTION>");
  lines.push("  <PLAYLISTS>");
  lines.push('    <NODE Type="0" Name="ROOT" Count="1">');
  lines.push(`      <NODE Name="${esc(playlist)}" Type="1" KeyType="0" Entries="${tracks.length}">`);
  tracks.forEach((_, i) => lines.push(`        <TRACK Key="${i + 1}"/>`));
  lines.push("      </NODE>");
  lines.push("    </NODE>");
  lines.push("  </PLAYLISTS>");
  lines.push("</DJ_PLAYLISTS>");
  return lines.join("\n") + "\n";
}
