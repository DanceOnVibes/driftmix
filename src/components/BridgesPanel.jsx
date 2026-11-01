import { useEffect, useReducer, useRef, useState } from "react";
import { Fold } from "./Fold.jsx";
import { bridges, addClips, removeClip, setClipMode, readyClips } from "../audio/bridges.js";
import { BRIDGE_BARS } from "../lib/bridgeClip.js";

const MODES = { every: "Every mix", clash: "Only when the keys clash", off: "Off" };

/**
 * Bridges: short beat-only clips Auto DJ plays between tracks.
 */
export function BridgesPanel() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  useEffect(() => bridges.subscribe(refresh), []);
  const ready = readyClips().length;
  const summary = bridges.clips.length ? `${ready} clip${ready === 1 ? "" : "s"} · ${MODES[bridges.mode].toLowerCase()}` : "no clips yet";
  return (
    <Fold id="bridges" label="Bridges" summary={summary}>
      <div
        className={`bridges${dragging ? " autodj-drop" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addClips(e.dataTransfer.files);
        }}
      >
        <p className="muted fnote">
          Short beat-only clips (drums, percussion, a riser) that play between tracks: the track going out blends into the clip, the clip carries the beat on its own, then the next track blends in. No melody means no key, so tracks whose keys clash never meet. Best made as 4 or 8 bars, starting on the first kick; DriftMix trims them to whole bars and fits them to the set&apos;s tempo. Each bridge lasts {BRIDGE_BARS} bars.
        </p>
        <div className="autodj-tools">
          <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()} data-testid="clips-add">
            Add clips
          </button>
          <label className="tempo-choice">
            <span>Play bridges</span>
            <select value={bridges.mode} onChange={(e) => setClipMode(e.target.value)} data-testid="clips-mode">
              {Object.entries(MODES).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept="audio/*,.mp3,.wav,.flac,.aiff,.m4a,.ogg"
          data-testid="clips-input"
          onChange={(e) => {
            addClips(e.target.files);
            e.target.value = "";
          }}
        />
        {bridges.clips.length > 0 && (
          <ol className="clip-list" data-testid="clip-list">
            {bridges.clips.map((c) => (
              <li key={c.id} className={c.status === "failed" ? "row-out" : ""}>
                <span className="row-name" title={c.name}>
                  {c.name}
                </span>
                <span className="muted">{c.status === "reading" ? "reading…" : c.status === "failed" ? c.note : `${Math.round(c.bpm * 10) / 10} BPM · ${c.bars} bars`}</span>
                <button type="button" className="link-btn" onClick={() => removeClip(c.id)} aria-label={`Remove ${c.name}`}>
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Fold>
  );
}
