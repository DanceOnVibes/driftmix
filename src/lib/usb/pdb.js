/**
 * Reads the track list on a DJ USB stick: PIONEER/rekordbox/export.pdb, the
 * "Device Library" that CDJ/XDJ players such as the XDJ-RX2 read. Read-only:
 * nothing here ever writes to a stick.
 *
 * The layout comes from Deep Symmetry's published, reverse-engineered
 * description of the format (crate-digger, "rekordbox_pdb.ksy"; thanks to
 * @henrybetts, @flesniak and James Elliott). In short: the file is made of
 * fixed-size pages; the first page lists the tables (tracks, artists, keys,
 * playlists…), each table is a chain of pages, and each page keeps its rows
 * in a heap found through an index at the end of the page.
 *
 * Plain bytes in, plain objects out: tested without a browser.
 */

export const TABLES = {
  0: "tracks",
  1: "genres",
  2: "artists",
  3: "albums",
  4: "labels",
  5: "keys",
  6: "colors",
  7: "playlistTree",
  8: "playlistEntries",
  11: "historyPlaylists",
  12: "historyEntries",
  13: "artwork",
};

const PAGE_HEADER = 0x28;

/** A string in the database: short ASCII, long ASCII or long UTF-16. */
export function readString(view, at) {
  const kind = view.getUint8(at);
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (kind === 0x40 || kind === 0x90) {
    const length = view.getUint16(at + 1, true);
    const body = bytes.subarray(at + 4, at + length);
    return new TextDecoder(kind === 0x90 ? "utf-16le" : "latin1").decode(body);
  }
  if (kind & 1) return new TextDecoder("latin1").decode(bytes.subarray(at + 1, at + (kind >> 1)));
  return "";
}

/** Every row (its byte position) in every table, following each table's chain of pages. */
export function readTables(buffer) {
  const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  if (view.byteLength < 64) throw new Error("Too short to be a rekordbox database");
  const pageSize = view.getUint32(4, true);
  const tableCount = view.getUint32(8, true);
  if (pageSize < 512 || pageSize > 65536 || tableCount > 64) throw new Error("Not a rekordbox database");
  const tables = {};
  for (let i = 0; i < tableCount; i++) {
    const at = 28 + i * 16;
    const type = view.getUint32(at, true);
    const first = view.getUint32(at + 8, true);
    const last = view.getUint32(at + 12, true);
    const rows = [];
    const seen = new Set();
    let page = first;
    while (!seen.has(page) && (page + 1) * pageSize <= view.byteLength) {
      seen.add(page);
      const base = page * pageSize;
      if (view.getUint32(base + 8, true) !== type) break;
      const next = view.getUint32(base + 12, true);
      const packed = view.getUint8(base + 24) | (view.getUint8(base + 25) << 8) | (view.getUint8(base + 26) << 16);
      const offsets = packed & 0x1fff;
      const flags = view.getUint8(base + 27);
      if ((flags & 0x40) === 0 && offsets) {
        for (let g = 0; g * 16 < offsets; g++) {
          const groupBase = base + pageSize - g * 0x24;
          const present = view.getUint16(groupBase - 4, true);
          for (let r = 0; r < 16 && g * 16 + r < offsets; r++) {
            if ((present >> r) & 1) rows.push(base + PAGE_HEADER + view.getUint16(groupBase - (6 + 2 * r), true));
          }
        }
      }
      if (page === last) break;
      page = next;
    }
    tables[TABLES[type] ?? `table${type}`] = rows;
  }
  return { view, pageSize, tables };
}

function idNames(view, rows, nameAt) {
  const names = new Map();
  for (const row of rows) names.set(view.getUint32(row, true), readString(view, row + nameAt));
  return names;
}

/** Artists (and albums) keep their name offset inside the row. */
function namedRows(view, rows, idAt, nearAt) {
  const names = new Map();
  for (const row of rows) {
    const subtype = view.getUint16(row, true);
    const id = view.getUint32(row + idAt, true);
    const offset = subtype & 0x04 ? view.getUint16(row + nearAt + 1, true) : view.getUint8(row + nearAt); // long rows keep a 2-byte offset
    names.set(id, readString(view, row + offset));
  }
  return names;
}

/**
 * The whole library, ready to show.
 * @returns {{ tracks: object[], playlists: { id, parentId, name, folder, order, trackIds: number[] }[] }}
 */
export function readLibrary(buffer) {
  const { view, tables } = readTables(buffer);
  const keys = idNames(view, tables.keys ?? [], 8);
  const genres = idNames(view, tables.genres ?? [], 4);
  const artists = namedRows(view, tables.artists ?? [], 4, 9);
  const albums = namedRows(view, tables.albums ?? [], 12, 21);
  const tracks = (tables.tracks ?? []).map((row) => {
    const u16 = (o) => view.getUint16(row + o, true);
    const u32 = (o) => view.getUint32(row + o, true);
    const text = (i) => readString(view, row + u16(0x5e + i * 2));
    return {
      id: u32(0x48),
      title: text(17),
      artist: artists.get(u32(0x44)) ?? "",
      album: albums.get(u32(0x40)) ?? "",
      genre: genres.get(u32(0x3c)) ?? "",
      key: keys.get(u32(0x20)) ?? "",
      bpm: u32(0x38) / 100,
      seconds: u16(0x54),
      sampleRate: u32(0x08),
      sampleDepth: u16(0x52),
      bitrate: u32(0x30),
      fileSize: u32(0x10),
      filePath: text(20),
      fileName: text(19),
      analyzePath: text(14),
      dateAdded: text(10),
    };
  });
  const entries = (tables.playlistEntries ?? []).map((row) => ({
    index: view.getUint32(row, true),
    trackId: view.getUint32(row + 4, true),
    playlistId: view.getUint32(row + 8, true),
  }));
  const playlists = (tables.playlistTree ?? []).map((row) => {
    const id = view.getUint32(row + 12, true);
    return {
      id,
      parentId: view.getUint32(row, true),
      order: view.getUint32(row + 8, true),
      folder: view.getUint32(row + 16, true) !== 0,
      name: readString(view, row + 20),
      trackIds: entries
        .filter((e) => e.playlistId === id)
        .sort((a, b) => a.index - b.index)
        .map((e) => e.trackId),
    };
  });
  playlists.sort((a, b) => a.parentId - b.parentId || a.order - b.order);
  return { tracks: tracks.sort((a, b) => a.id - b.id), playlists };
}
