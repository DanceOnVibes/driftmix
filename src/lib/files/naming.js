/**
 * File names and key labels for exported tracks.
 */

/** "A minor" → "Am", "F# major" → "F#" (the short form DJ apps put in the key tag). */
export function shortKey(name) {
  const m = /^([A-G](?:#|b)?)\s+(major|minor)$/.exec(String(name || "").trim());
  if (!m) return "";
  return m[2] === "minor" ? `${m[1]}m` : m[1];
}

/** Characters that aren't allowed in file names on Windows, Mac or phones. */
export function safeName(s) {
  return String(s)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

/**
 * "01 The Drift3r – Inspiration (128 BPM, 8A).mp3"
 * @param {{ track?: number, artist?: string, title: string, bpm?: number, camelot?: string, ext: string, withInfo?: boolean }} o
 */
export function exportName({ track, artist, title, bpm, camelot, ext, withInfo = true }) {
  const parts = [];
  if (track) parts.push(String(track).padStart(2, "0"));
  parts.push(artist ? `${artist} – ${title}` : title);
  let name = parts.join(" ");
  if (withInfo && (bpm || camelot)) {
    const info = [bpm ? `${Math.round(bpm)} BPM` : "", camelot || ""].filter(Boolean).join(", ");
    name += ` (${info})`;
  }
  return `${safeName(name) || "track"}.${ext}`;
}
