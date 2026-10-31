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

/**
 * A track's name as people want to read it, from its file name: no
 * extension, no upload numbers ("_180631456"), no "(130 BPM, 2A)" or "(8A)"
 * that DriftMix or a DJ app added, no leading track number ("07 ", "3. "),
 * no "- by The Drift3r" credit at the end, and "_" as spaces. The file
 * itself is never renamed. Safe to run twice.
 *   "07 Lost in the RHYTHM - by The Drift3r (130 BPM, 2A).mp3" → "Lost in the RHYTHM"
 */
export function tidyName(fileName) {
  let s = String(fileName || "")
    .replace(/\.(mp3|wav|flac|aiff?|m4a|aac|ogg|opus|webm)$/i, "")
    .replace(/([_ -]\d{6,})+/g, "")
    .replace(/_+/g, " ");
  // A DriftMix export ("12 Title (134 BPM, 8A)"): its leading number is a track number.
  const exported = /\(\s*\d{2,3}(?:[.,]\d+)?\s*BPM/i.test(s);
  if (exported) s = s.replace(/^\d{1,3}\s+(?=\S)/, "");
  s = s
    .replace(/\s*\(\s*\d{2,3}(?:[.,]\d+)?\s*BPM(?:\s*,\s*\d{1,2}[AB])?\s*\)/gi, "")
    .replace(/\s*\(\s*\d{1,2}[AB]\s*\)/g, "")
    .replace(/\s*\(\d{1,2}\)\s*$/, "") // "Ride the Wave (1)": a download copy number
    .replace(/\s+[-–]\s+by\s+\S.*$/i, "")
    .replace(/^(?:0\d|\d{1,2}[.)])\s*(?:[-–]\s+)?(?=\S)/, "")
    .replace(/^\d{1,2}\s+[-–]\s+/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s || String(fileName || "").replace(/\.[^.]+$/, "").trim();
}
