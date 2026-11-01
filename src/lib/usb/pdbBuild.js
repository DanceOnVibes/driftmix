/**
 * Builds a small export.pdb in memory, laid out the way rekordbox lays it
 * out (see pdb.js). Used by the tests to check the reader against known
 * contents; not used by the app yet. Each table fits in one page here
 * (up to 16 rows per index group, several groups per page).
 */

const PAGE = 4096;
const HEAP = 0x28;

function shortOrLongString(text) {
  const ascii = /^[\x20-\x7e]*$/.test(text) && text.length < 126;
  if (ascii) {
    const out = new Uint8Array(text.length + 1);
    out[0] = ((text.length + 1) << 1) | 1;
    for (let i = 0; i < text.length; i++) out[i + 1] = text.charCodeAt(i);
    return out;
  }
  const body = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    body[i * 2] = c & 0xff;
    body[i * 2 + 1] = c >> 8;
  }
  const out = new Uint8Array(4 + body.length);
  out[0] = 0x90;
  out[1] = (4 + body.length) & 0xff;
  out[2] = (4 + body.length) >> 8;
  out.set(body, 4);
  return out;
}

/** A row: fixed fields written by `fill(view)`, then strings placed after them. */
function row(fixed, fill, strings = [], stringOffsetsAt = null) {
  const parts = strings.map(shortOrLongString);
  const size = fixed + parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(size + (size % 2));
  const view = new DataView(bytes.buffer);
  fill(view);
  let at = fixed;
  parts.forEach((p, i) => {
    if (stringOffsetsAt !== null) view.setUint16(stringOffsetsAt + i * 2, at, true);
    bytes.set(p, at);
    at += p.length;
  });
  return { bytes, firstString: fixed };
}

function page(index, type, rows) {
  const bytes = new Uint8Array(PAGE);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, index, true);
  view.setUint32(8, type, true);
  view.setUint32(12, 0x3fffffff, true); // next page: none
  const packed = rows.length | (rows.length << 13);
  bytes[24] = packed & 0xff;
  bytes[25] = (packed >> 8) & 0xff;
  bytes[26] = (packed >> 16) & 0xff;
  bytes[27] = 0x24; // a data page
  let heap = 0;
  rows.forEach((r, i) => {
    bytes.set(r.bytes, HEAP + heap);
    const g = Math.floor(i / 16);
    const base = PAGE - g * 0x24;
    view.setUint16(base - (6 + 2 * (i % 16)), heap, true);
    view.setUint16(base - 4, view.getUint16(base - 4, true) | (1 << i % 16), true);
    heap += r.bytes.length;
  });
  if (HEAP + heap > PAGE - Math.ceil(rows.length / 16) * 0x24) throw new Error("too many rows for one test page");
  return bytes;
}

/**
 * @param {{ tracks: object[], artists?: object[], albums?: object[], genres?: object[], keys?: object[], playlists?: object[] }} db
 * @returns {ArrayBuffer}
 */
export function buildPdb({ tracks = [], artists = [], albums = [], genres = [], keys = [], playlists = [] }) {
  const tables = [];
  tables.push([
    0,
    tracks.map((t) =>
      row(
        0x88,
        (v) => {
          v.setUint16(0, 0x24, true);
          v.setUint32(0x08, t.sampleRate ?? 44100, true);
          v.setUint32(0x10, t.fileSize ?? 0, true);
          v.setUint32(0x20, t.keyId ?? 0, true);
          v.setUint32(0x30, t.bitrate ?? 1411, true);
          v.setUint32(0x38, Math.round((t.bpm ?? 0) * 100), true);
          v.setUint32(0x3c, t.genreId ?? 0, true);
          v.setUint32(0x40, t.albumId ?? 0, true);
          v.setUint32(0x44, t.artistId ?? 0, true);
          v.setUint32(0x48, t.id, true);
          v.setUint16(0x52, t.sampleDepth ?? 16, true);
          v.setUint16(0x54, t.seconds ?? 0, true);
        },
        Array.from({ length: 21 }, (_, i) =>
          i === 17 ? t.title ?? "" : i === 20 ? t.filePath ?? "" : i === 19 ? t.fileName ?? "" : i === 14 ? t.analyzePath ?? "" : i === 10 ? t.dateAdded ?? "" : "",
        ),
        0x5e,
      ),
    ),
  ]);
  tables.push([1, genres.map((g) => row(4, (v) => v.setUint32(0, g.id, true), [g.name]))]);
  tables.push([
    2,
    artists.map((a) =>
      row(
        10,
        (v) => {
          v.setUint16(0, 0x60, true);
          v.setUint32(4, a.id, true);
          v.setUint8(8, 3);
          v.setUint8(9, 10);
        },
        [a.name],
      ),
    ),
  ]);
  tables.push([
    3,
    albums.map((a) =>
      row(
        22,
        (v) => {
          v.setUint16(0, 0x80, true);
          v.setUint32(12, a.id, true);
          v.setUint8(21, 22);
        },
        [a.name],
      ),
    ),
  ]);
  tables.push([
    5,
    keys.map((k) =>
      row(
        8,
        (v) => {
          v.setUint32(0, k.id, true);
          v.setUint32(4, k.id, true);
        },
        [k.name],
      ),
    ),
  ]);
  tables.push([
    7,
    playlists.map((p, i) =>
      row(
        20,
        (v) => {
          v.setUint32(0, p.parentId ?? 0, true);
          v.setUint32(8, p.order ?? i, true);
          v.setUint32(12, p.id, true);
          v.setUint32(16, p.folder ? 1 : 0, true);
        },
        [p.name],
      ),
    ),
  ]);
  tables.push([
    8,
    playlists.flatMap((p) =>
      (p.trackIds ?? []).map((trackId, i) =>
        row(12, (v) => {
          v.setUint32(0, i + 1, true);
          v.setUint32(4, trackId, true);
          v.setUint32(8, p.id, true);
        }),
      ),
    ),
  ]);
  const pages = [new Uint8Array(PAGE)];
  const head = new DataView(pages[0].buffer);
  head.setUint32(4, PAGE, true);
  head.setUint32(8, tables.length, true);
  head.setUint32(12, tables.length + 1, true);
  head.setUint32(20, 1, true);
  tables.forEach(([type, rows], i) => {
    const index = i + 1;
    pages.push(page(index, type, rows));
    head.setUint32(28 + i * 16, type, true);
    head.setUint32(28 + i * 16 + 4, index, true);
    head.setUint32(28 + i * 16 + 8, index, true);
    head.setUint32(28 + i * 16 + 12, index, true);
  });
  const out = new Uint8Array(pages.length * PAGE);
  pages.forEach((p, i) => out.set(p, i * PAGE));
  return out.buffer;
}
