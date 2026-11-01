/**
 * "Check my USB": what a CDJ/XDJ will show from a stick, in plain words.
 * Puts together the track list (pdb.js), the analysis files (anlz.js) and
 * the files actually on the stick. Pure: tested without a browser.
 */

const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|aac|alac)$/i;

/** "/Contents/a/b.wav" → "contents/a/b.wav" (stick paths, compared without case, like FAT32 does). */
export const stickPath = (p) => String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();

/**
 * @param {object} o
 * @param {{ tracks: object[], playlists: object[] } | null} o.library  null: no track list on the stick
 * @param {string[]} o.files  every file on the stick, relative to its root ("Contents/…", "PIONEER/…")
 * @param {Map<string, object>} o.analysis  stickPath(analyzePath) → readAnlz result (the .DAT)
 * @param {boolean} o.oneLibrary  the newer library file (for CDJ-3000X class players) is there
 * @param {boolean} o.wholeStick  the whole stick was picked (not just the PIONEER folder)
 */
export function usbReport({ library, files, analysis, oneLibrary, wholeStick }) {
  const onStick = new Set(files.map(stickPath));
  const problems = [];
  if (!library) {
    return {
      verdict: "none",
      headline: "No rekordbox track list on this stick, so a CDJ or XDJ will only show it under FOLDER, without waveforms, BPM or key.",
      tracks: [],
      playlists: [],
      problems: [],
      loose: files.filter((f) => AUDIO.test(f)).length,
      oneLibrary,
    };
  }
  const byId = new Map(library.tracks.map((t) => [t.id, t]));
  const tracks = library.tracks.map((t) => {
    const a = analysis.get(stickPath(t.analyzePath)) ?? null;
    return {
      id: t.id,
      title: t.title,
      artist: t.artist,
      bpm: t.bpm,
      key: t.key,
      seconds: t.seconds,
      filePath: t.filePath,
      audio: wholeStick ? onStick.has(stickPath(t.filePath)) : null,
      waveform: Boolean(a?.waveform),
      grid: Boolean(a?.beats),
    };
  });
  const named = new Map(tracks.map((t) => [t.id, t]));
  const playlists = library.playlists
    .filter((p) => !p.folder)
    .map((p) => ({ name: p.name, count: p.trackIds.length, unknown: p.trackIds.filter((id) => !byId.has(id)).length, tracks: p.trackIds.map((id) => named.get(id)).filter(Boolean) }));

  const missingAudio = tracks.filter((t) => t.audio === false);
  const noAnalysis = tracks.filter((t) => !t.waveform || !t.grid);
  const noKey = tracks.filter((t) => !t.key);
  const noBpm = tracks.filter((t) => !(t.bpm > 0));
  const listed = new Set(tracks.map((t) => stickPath(t.filePath)));
  const loose = wholeStick ? files.filter((f) => AUDIO.test(f) && !listed.has(stickPath(f))).length : 0;

  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  if (missingAudio.length) problems.push(`${n(missingAudio.length, "track is", "tracks are")} in the list but the music file is missing from the stick, so ${missingAudio.length === 1 ? "it" : "they"} won't load: ${missingAudio.map((t) => t.title).join(", ")}.`);
  if (noAnalysis.length) problems.push(`${n(noAnalysis.length, "track has", "tracks have")} no waveform or beat grid on the stick (analyse in rekordbox and export again): ${noAnalysis.map((t) => t.title).join(", ")}.`);
  if (noKey.length) problems.push(`${n(noKey.length, "track has", "tracks have")} no key (tick KEY in rekordbox's analysis settings, analyse, export again): ${noKey.map((t) => t.title).join(", ")}.`);
  if (noBpm.length) problems.push(`${n(noBpm.length, "track has", "tracks have")} no BPM: ${noBpm.map((t) => t.title).join(", ")}.`);
  const empty = playlists.filter((p) => !p.count);
  if (empty.length) problems.push(`${n(empty.length, "playlist is", "playlists are")} empty: ${empty.map((p) => p.name).join(", ")}.`);
  if (tracks.length && !playlists.length) problems.push("There are tracks but no playlists: on the player they're only under TRACK, KEY, BPM and so on, not PLAYLIST.");
  if (loose) problems.push(`${n(loose, "music file on the stick isn't", "music files on the stick aren't")} in the track list: ${loose === 1 ? "it only shows" : "they only show"} under FOLDER, without waveform, BPM or key.`);

  let verdict = "ready";
  let headline = `Ready for the decks: ${n(tracks.length, "track", "tracks")} in ${n(playlists.length, "playlist", "playlists")}, with waveforms, BPM and key.`;
  if (!tracks.length) {
    verdict = "empty";
    headline = "The track list on this stick is empty: an XDJ or CDJ will show nothing under PLAYLIST. Export a playlist from rekordbox again.";
  } else if (problems.length) {
    verdict = "problems";
    headline = `${n(tracks.length, "track", "tracks")} will show on the decks, but ${n(problems.length, "thing needs", "things need")} a look.`;
  }
  return { verdict, headline, tracks, playlists, problems, loose, oneLibrary };
}
