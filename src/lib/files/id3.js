/**
 * ID3v2.3 tags: the title, artist, BPM, key, cover and so on that music apps
 * read from MP3 files (and from WAV files, inside an "id3 " chunk).
 * Text is written as UTF-16, so names like "DanceOnVibes – The Drift3r"
 * (with its en dash) and Romanian or Hungarian letters come out right.
 */

/**
 * @param {object} tags
 * @param {string} [tags.title]  @param {string} [tags.artist]  @param {string} [tags.albumArtist]
 * @param {string} [tags.album]  @param {string|number} [tags.track]  @param {string|number} [tags.year]
 * @param {string} [tags.genre]  @param {number} [tags.bpm]  @param {string} [tags.key]  (e.g. "Am")
 * @param {string} [tags.comment]  @param {string} [tags.copyright]
 * @param {{ mime: string, bytes: Uint8Array }} [tags.cover]
 * @returns {Uint8Array}  the whole tag, header included
 */
export function buildId3(tags) {
  const frames = [];
  const text = (id, value) => {
    if (value === undefined || value === null || String(value).trim() === "") return;
    frames.push(frame(id, concat([Uint8Array.of(1), utf16(String(value))])));
  };
  text("TIT2", tags.title);
  text("TPE1", tags.artist);
  text("TPE2", tags.albumArtist);
  text("TALB", tags.album);
  text("TRCK", tags.track);
  text("TYER", tags.year);
  text("TCON", tags.genre);
  if (tags.bpm > 0) text("TBPM", Math.round(tags.bpm));
  text("TKEY", tags.key);
  text("TCOP", tags.copyright);
  if (tags.comment) {
    // COMM: encoding, language, empty description, then the text.
    frames.push(frame("COMM", concat([Uint8Array.of(1), ascii("eng"), utf16(""), Uint8Array.of(0, 0), utf16(tags.comment)])));
  }
  if (tags.cover && tags.cover.bytes?.length) {
    // APIC: encoding 0, mime type, picture type 3 (front cover), empty description.
    frames.push(frame("APIC", concat([Uint8Array.of(0), ascii(tags.cover.mime), Uint8Array.of(0, 3, 0), tags.cover.bytes])));
  }
  const body = concat(frames);
  const header = new Uint8Array(10);
  header.set(ascii("ID3"), 0);
  header[3] = 3; // version 2.3
  header[4] = 0;
  header[5] = 0; // no flags
  header.set(synchsafe(body.length), 6);
  return concat([header, body]);
}

/** Text as UTF-16 little-endian with a byte-order mark (no terminator). */
function utf16(s) {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[3 + i * 2] = c >> 8;
  }
  return out;
}

function ascii(s) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
}

function frame(id, payload) {
  const out = new Uint8Array(10 + payload.length);
  out.set(ascii(id), 0);
  const n = payload.length;
  out[4] = (n >>> 24) & 0xff;
  out[5] = (n >>> 16) & 0xff;
  out[6] = (n >>> 8) & 0xff;
  out[7] = n & 0xff;
  out.set(payload, 10);
  return out;
}

/** ID3's header size uses 7 bits per byte. */
function synchsafe(n) {
  return Uint8Array.of((n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f);
}

export function concat(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
