import { useEffect, useReducer, useRef } from "react";
import { Fold } from "./Fold.jsx";
import { usb, checkUsb } from "../audio/usbCheck.js";
import { formatTime } from "../lib/mixer.js";

const SUMMARY = { idle: "for CDJs and XDJs", reading: "reading…", failed: "couldn't read it" };
const VERDICT = { ready: "ready for the decks", problems: "needs a look", empty: "track list empty", none: "no track list" };

/**
 * Check my USB: pick a stick, see what a CDJ/XDJ will show. Read-only.
 */
export function UsbCheck() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  const input = useRef(null);
  useEffect(() => usb.subscribe(refresh), []);
  const r = usb.report;
  return (
    <Fold id="usbcheck" label="Check my USB" summary={r ? VERDICT[r.verdict] : SUMMARY[usb.status]}>
      <div className="usb">
        <p className="muted fnote">
          Pick your USB stick (the whole drive) and DriftMix tells you what an XDJ or CDJ will show: tracks, playlists, BPM, key, and anything missing. It only reads the stick, never changes it. Your browser may say &quot;upload&quot;: nothing leaves your computer.
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()} disabled={usb.status === "reading"} data-testid="usb-pick">
          {usb.status === "reading" ? "Reading the stick…" : r ? "Check another stick" : "Pick the USB stick"}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          // A folder picker: the browser lists the files, DriftMix reads only the track list and analysis files.
          webkitdirectory=""
          directory=""
          multiple
          data-testid="usb-input"
          onChange={(e) => {
            void checkUsb(e.target.files);
            e.target.value = "";
          }}
        />
        {usb.message && (
          <p className="autodj-note" role="status" data-testid="usb-message">
            {usb.message}
          </p>
        )}
        {r && (
          <div className="usb-result" data-testid="usb-result">
            <p className={`usb-verdict usb-${r.verdict}`} role="status" data-testid="usb-verdict">
              {r.headline}
            </p>
            {r.problems.length > 0 && (
              <ul className="usb-issues" data-testid="usb-problems">
                {r.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {!r.wholeStick && r.verdict !== "none" && <p className="muted fnote">You picked the PIONEER folder only, so DriftMix couldn&apos;t check the music files themselves. Pick the whole stick for that.</p>}
            {r.playlists.map((p) => (
              <details key={p.name} className="usb-pl" data-testid="usb-playlist">
                <summary>
                  {p.name} <span className="muted">· {p.count} track{p.count === 1 ? "" : "s"}</span>
                </summary>
                <ol className="usb-tracks">
                  {p.tracks.map((t) => (
                    <li key={t.id} className={t.audio === false || !t.waveform || !t.key ? "usb-bad" : ""}>
                      <span className="usb-title" title={t.filePath}>
                        {t.title}
                      </span>
                      <span>{t.bpm ? t.bpm.toFixed(2) : "–"}</span>
                      <span>{t.key || "–"}</span>
                      <span>{t.seconds ? formatTime(t.seconds) : ""}</span>
                      <span title={t.waveform ? "Waveform and beat grid on the stick" : "No waveform or beat grid"}>{t.waveform && t.grid ? "〰" : "✕"}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
            <p className="muted fnote">
              Older players (XDJ-RX2, CDJ-2000NXS2 and similar) read this track list. Newer ones (CDJ-3000X, XDJ-AZ, OPUS-QUAD, OMNIS-DUO) read rekordbox&apos;s newer OneLibrary, which is locked so DriftMix can&apos;t open it:{" "}
              {r.oneLibrary ? "it's on this stick." : "it isn't on this stick."}
            </p>
          </div>
        )}
      </div>
    </Fold>
  );
}
