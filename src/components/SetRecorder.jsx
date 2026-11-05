import { useEffect, useReducer, useState } from "react";
import { formatTime } from "../lib/mixer.js";
import { setRec, startSetRecording, stopSetRecording, discardOutput, setAutoStop } from "../audio/setrec.js";
import { drawMixCard } from "../audio/mixCard.js";
import { files } from "../audio/files.js";

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
          {setRec.final.length > 0 && <MixCard key={out.url} />}
        </div>
      )}
    </div>
  );
}

/**
 * The mix card: a picture of the set (length, tracks, tempo, key path,
 * tracklist) to post or send. Made on this device; no audio in it.
 */
function MixCard() {
  const [title, setTitle] = useState("My DriftMix set");
  const [card, setCard] = useState(null); // { url, file }
  const [status, setStatus] = useState("");
  useEffect(() => () => card && URL.revokeObjectURL(card.url), [card]);

  async function make() {
    setStatus("Making the card…");
    try {
      const blob = await drawMixCard({ title: title.trim(), by: files.common.artist || "", date: new Date(), seconds: setRec.output.seconds, entries: setRec.final });
      const name = `${(title.trim() || "DriftMix set").replace(/[\\/:*?"<>|]+/g, " ").trim()} - mix card.png`;
      setCard({ url: URL.createObjectURL(blob), file: new File([blob], name, { type: "image/png" }) });
      setStatus("");
    } catch {
      setStatus("Couldn't make the card in this browser.");
    }
  }

  const canShare = Boolean(card && navigator.canShare?.({ files: [card.file] }));
  async function share() {
    try {
      await navigator.share({ files: [card.file], title: title.trim() || "My DriftMix set", text: setRec.tracklist });
    } catch {
      /* closed the share sheet: nothing to do */
    }
  }

  return (
    <div className="mixcard" data-testid="mixcard">
      <p className="mixcard-head">Mix card</p>
      <p className="fnote muted">A picture of your set to post: tracklist with times, tempo and the key path. Made on this device; no audio in it.</p>
      <div className="autodj-tools">
        <label className="mixcard-title">
          <span className="muted">Title</span>
          <input type="text" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} data-testid="mixcard-title" />
        </label>
        <button type="button" className="btn btn-gold" onClick={() => void make()} data-testid="mixcard-make">
          {card ? "Make it again" : "Make the mix card"}
        </button>
      </div>
      {status && <p className="fnote">{status}</p>}
      {card && (
        <>
          <img className="mixcard-img" src={card.url} alt={`Mix card: ${title}`} data-testid="mixcard-img" />
          <div className="autodj-tools">
            {canShare && (
              <button type="button" className="btn btn-gold" onClick={() => void share()} data-testid="mixcard-share">
                Share
              </button>
            )}
            <a className={`btn ${canShare ? "btn-ghost" : "btn-gold"}`} href={card.url} download={card.file.name} data-testid="mixcard-save">
              Save image
            </a>
          </div>
        </>
      )}
    </div>
  );
}
