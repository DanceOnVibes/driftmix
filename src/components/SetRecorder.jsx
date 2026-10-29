import { useEffect, useReducer, useState } from "react";
import { formatTime } from "../lib/mixer.js";
import { setRec, startSetRecording, stopSetRecording, discardOutput, setAutoStop } from "../audio/setrec.js";

/**
 * Record the set: one button, then the MP3 and a tracklist timed for YouTube
 * chapters or a SoundCloud description.
 */
export function SetRecorder() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => setRec.subscribe(refresh), []);
  const [copied, setCopied] = useState(false);
  const recording = setRec.state === "recording";
  const out = setRec.output;

  async function copy() {
    try {
      await navigator.clipboard.writeText(setRec.tracklist);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      document.querySelector("[data-testid=tracklist]")?.select();
    }
  }

  const txtUrl = out && setRec.tracklist ? URL.createObjectURL(new Blob([setRec.tracklist + "\n"], { type: "text/plain" })) : null;
  useEffect(() => () => txtUrl && URL.revokeObjectURL(txtUrl), [txtUrl]);

  return (
    <div className="setrec" data-testid="setrec">
      <div className="autodj-tools">
        {recording ? (
          <button type="button" className="btn btn-silver" onClick={() => void stopSetRecording()} data-testid="setrec-toggle">
            ■ Stop recording
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => void startSetRecording()} disabled={setRec.state === "finishing"} data-testid="setrec-toggle">
            ● Record the set
          </button>
        )}
        <span className={`booth-clock${recording ? " on" : ""}`} data-testid="setrec-clock">
          {recording
            ? `Recording · ${formatTime(setRec.seconds)} · ${(setRec.bytes / 1048576).toFixed(1)} MB`
            : setRec.state === "finishing"
              ? "Finishing the file…"
              : "Records everything the decks play, as MP3 320 kbps, with a tracklist."}
        </span>
        <label className="fcheck">
          <input type="checkbox" checked={setRec.autoStop} onChange={(e) => setAutoStop(e.target.checked)} />
          <span>Stop when the set ends</span>
        </label>
      </div>
      {recording && setRec.entries.length > 0 && (
        <p className="fnote muted" data-testid="setrec-now">
          Tracklist so far: {setRec.entries.length} track{setRec.entries.length === 1 ? "" : "s"}. Keep this tab open while you record.
        </p>
      )}
      {setRec.message && <p className="autodj-note">{setRec.message}</p>}
      {out && (
        <div className="setrec-out">
          <div className="autodj-tools">
            <a className="btn btn-gold" href={out.url} download={out.name} data-testid="setrec-save">
              Save the set ({formatTime(out.seconds)}, {(out.size / 1048576).toFixed(1)} MB)
            </a>
            {setRec.tracklist && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => void copy()} data-testid="tracklist-copy">
                  {copied ? "Copied ✓" : "Copy tracklist"}
                </button>
                <a className="btn btn-ghost" href={txtUrl} download={out.name.replace(/\.mp3$/, " tracklist.txt")} data-testid="tracklist-save">
                  Save tracklist (.txt)
                </a>
              </>
            )}
            <button type="button" className="link-btn" onClick={discardOutput}>
              Discard
            </button>
          </div>
          {setRec.tracklist && (
            <>
              <textarea className="tracklist" readOnly value={setRec.tracklist} rows={Math.min(14, setRec.tracklist.split("\n").length + 1)} data-testid="tracklist" />
              <p className="fnote muted">Paste it into a YouTube description and each line becomes a chapter (YouTube needs at least 3, starting at 00:00).</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
