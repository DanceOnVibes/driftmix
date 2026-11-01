/**
 * Reads a track's analysis file on a DJ USB stick (PIONEER/USBANLZ/…/ANLZ0000.DAT
 * and .EXT): the beat grid, waveforms and cue points the players show.
 * Read-only. Layout from Deep Symmetry's published description
 * (crate-digger, "rekordbox_anlz.ksy").
 *
 * The file is a "PMAI" header followed by tagged sections, each starting
 * with a four-letter name and its length (big-endian).
 */

const WAVEFORMS = new Set(["PWAV", "PWV2", "PWV3", "PWV4", "PWV5", "PWV6", "PWV7"]);

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ ok: boolean, path: string, beats: number, bpm: number|null, waveform: boolean, cueLists: number, tags: string[] }}
 */
export function readAnlz(buffer) {
  const view = new DataView(buffer);
  const out = { ok: false, path: "", beats: 0, bpm: null, waveform: false, cueLists: 0, tags: [] };
  if (view.byteLength < 28 || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "PMAI") return out;
  let at = view.getUint32(4, false);
  while (at + 12 <= view.byteLength) {
    const tag = String.fromCharCode(...new Uint8Array(buffer, at, 4));
    const length = view.getUint32(at + 8, false);
    if (length < 12 || at + length > view.byteLength) break;
    out.tags.push(tag);
    if (tag === "PPTH") {
      const n = view.getUint32(at + 12, false);
      out.path = new TextDecoder("utf-16be").decode(new Uint8Array(buffer, at + 16, Math.min(n, length - 16))).replace(/\0+$/, "");
    } else if (tag === "PQTZ") {
      const count = view.getUint32(at + 20, false);
      if (count && at + 24 + count * 8 <= at + length) {
        out.beats = count;
        out.bpm = view.getUint16(at + 26, false) / 100;
      }
    } else if (WAVEFORMS.has(tag)) {
      out.waveform = true;
    } else if (tag === "PCOB" || tag === "PCO2") {
      out.cueLists++;
    }
    at += length;
  }
  out.ok = out.tags.length > 0;
  return out;
}
