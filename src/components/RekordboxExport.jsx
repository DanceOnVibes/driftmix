import { useEffect, useReducer } from "react";
import { Fold } from "./Fold.jsx";
import { autoDj } from "../audio/autodj.js";
import { rekordbox, setFolder, setPlaylistName, exportPlan, exportRekordbox } from "../audio/rekordboxExport.js";

/**
 * Export for rekordbox: the playlist, with tempo, beat grid, key and hot
 * cues, as a file rekordbox imports; rekordbox then puts it on a USB stick
 * for CDJs (waveforms included).
 */
export function RekordboxExport() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const offs = [rekordbox.subscribe(refresh), autoDj.subscribe(refresh)];
    return () => offs.forEach((off) => off());
  }, []);
  const plan = exportPlan();
  const n = plan.tracks.length;
  return (
    <Fold id="rekordbox" label="Export for rekordbox" summary={`USB for CDJs · ${n} track${n === 1 ? "" : "s"}`}>
      <div className="rbx">
        <label className="ff">
          <span>Tracks folder</span>
          <input
            type="text"
            value={rekordbox.folder}
            placeholder="C:\Users\you\Music\My set   or   /Users/you/Music/My set"
            onChange={(e) => setFolder(e.target.value)}
            spellCheck={false}
            data-testid="rbx-folder"
          />
        </label>
        <label className="ff">
          <span>Playlist name</span>
          <input type="text" value={rekordbox.playlist} onChange={(e) => setPlaylistName(e.target.value)} data-testid="rbx-playlist" />
        </label>
        <p className="muted fnote">
          The folder your tracks are in: copy it from the address bar of File Explorer (Windows) or Finder (Mac). A web page can&apos;t see that by itself.
        </p>
        <button type="button" className="btn btn-gold" onClick={() => exportRekordbox()} disabled={!n} data-testid="rbx-export">
          Download the rekordbox file
        </button>
        {rekordbox.message && (
          <p className="autodj-note" role="status" data-testid="rbx-message">
            {rekordbox.message}
          </p>
        )}
        <ol className="rbx-steps">
          <li>
            In rekordbox: <b>Preferences → Advanced → Database → rekordbox xml</b>, choose this file. Under <b>View → Layout</b>, tick <b>rekordbox xml</b> so it shows in the list on the left.
          </li>
          <li>
            Open <b>rekordbox xml → Playlists</b>, right-click your playlist and import it. The tempo, beat grid, key and hot cues come with it.
          </li>
          <li>Plug in the USB stick and drag the playlist onto it. rekordbox draws the waveforms and writes everything the CDJs need.</li>
        </ol>
        <p className="muted fnote">Menu names can differ a little between rekordbox versions. Tracks in another folder show as missing: use rekordbox&apos;s Relocate to point to them.</p>
      </div>
    </Fold>
  );
}
