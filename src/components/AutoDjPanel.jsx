import { useEffect, useReducer, useRef, useState } from "react";
import { formatTime } from "../lib/mixer.js";
import { stepCost } from "../lib/setlist.js";
import { BAR_CHOICES } from "../lib/transition.js";
import { mix } from "../audio/transition.js";
import { decks } from "../audio/engine.js";
import {
  autoDj,
  addTracks,
  removeTrack,
  moveTrack,
  clearTracks,
  sortSet,
  startAutoDj,
  stopAutoDj,
  playable,
  setTempo,
  setLength,
  setBars,
} from "../audio/autodj.js";

const STEP = { 0: "green", 2: "amber", 3: "amber", 4: "amber", 10: "red" };
const STEP_WORDS = { green: "flows", amber: "mixable", red: "clash" };

/**
 * Auto DJ: add tracks, order them, press Start. Each row shows the track's
 * tempo and key and how well it flows from the track before it.
 */
export function AutoDjPanel() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const offs = [autoDj.subscribe(refresh), mix.subscribe(refresh), decks.a.subscribe(refresh), decks.b.subscribe(refresh)];
    return () => offs.forEach((off) => off());
  }, []);
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const tracks = autoDj.tracks;
  const setBpm = autoDj.setBpm ?? setTempo();
  const ready = tracks.filter((t) => playable(t, setBpm));
  const readingCount = tracks.filter((t) => t.status === "reading").length;
  const length = setLength();
  const live = new Set([autoDj.onDeck.a, autoDj.onDeck.b].filter(Boolean));

  // How each playable track flows from the playable one before it.
  const flow = new Map();
  let previous = null;
  for (const t of tracks) {
    if (!playable(t, setBpm)) continue;
    if (previous) {
      const level = STEP[stepCost({ camelot: previous.key?.camelot }, { camelot: t.key?.camelot })] ?? "amber";
      flow.set(t.id, level);
    }
    previous = t;
  }

  function badge(t) {
    if (autoDj.on && live.has(t.id)) {
      const deck = autoDj.onDeck.a === t.id ? decks.a : decks.b;
      return `${deck.playing ? "Playing" : "Next"} (${deck.id.toUpperCase()})`;
    }
    if (t.status === "reading") return "Reading…";
    if (t.status === "failed") return "Can't read";
    if (!t.tempo) return "No tempo";
    if (!playable(t, setBpm)) return `Too far from ${fmt(setBpm)}`;
    return "";
  }

  return (
    <section
      className={`autodj${dragging ? " autodj-drop" : ""}`}
      aria-label="Auto DJ"
      data-testid="autodj"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addTracks(e.dataTransfer.files);
      }}
    >
      <header className="autodj-head">
        <h2>Auto DJ</h2>
        <p className="muted">
          Add your tracks, put them in order, press Start. DriftMix mixes each one into the next, keys fixed, on the beat.
        </p>
      </header>

      <div className="autodj-tools">
        <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()}>
          Add tracks
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept="audio/*,.mp3,.wav,.flac,.aiff,.m4a,.ogg"
          data-testid="playlist-files"
          onChange={(e) => {
            addTracks(e.target.files);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn btn-ghost" onClick={sortSet} disabled={autoDj.on || ready.length < 3 || readingCount > 0} data-testid="sort">
          Order for a smooth set
        </button>
        <div className="bars" role="radiogroup" aria-label="Auto DJ blend length">
          {BAR_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={autoDj.bars === n}
              className={`bar-choice${autoDj.bars === n ? " bar-on" : ""}`}
              onClick={() => setBars(n)}
              disabled={autoDj.on}
            >
              {n} bars
            </button>
          ))}
        </div>
        {autoDj.on ? (
          <button type="button" className="btn btn-silver" onClick={() => stopAutoDj()} data-testid="autodj-toggle">
            Stop Auto DJ
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => void startAutoDj()}
            disabled={ready.length < 2}
            data-testid="autodj-toggle"
          >
            Start Auto DJ
          </button>
        )}
      </div>

      <p className="autodj-status" role="status" data-testid="autodj-status">
        {tracks.length === 0
          ? "No tracks yet. Press Add tracks, or drop a folder's worth of files here."
          : `${ready.length} of ${tracks.length} tracks ready${readingCount ? ` · reading ${readingCount}…` : ""}${
              setBpm ? ` · set tempo ${fmt(setBpm)} BPM` : ""
            }${length ? ` · about ${formatTime(length)} of music` : ""}`}
      </p>
      {autoDj.message && (
        <p className="autodj-note" data-testid="autodj-note">
          {autoDj.message}
        </p>
      )}

      {tracks.length > 0 && (
        <ol className="playlist" data-testid="playlist">
          {tracks.map((t, i) => {
            const level = flow.get(t.id);
            const isLiveRow = live.has(t.id) && autoDj.on;
            return (
              <li key={t.id} className={`${isLiveRow ? "row-live" : ""}${!playable(t, setBpm) && t.status !== "reading" ? " row-out" : ""}`}>
                <span className="row-n">{i + 1}</span>
                <span className="row-flow" title={level ? `Key ${STEP_WORDS[level]} from the track before` : ""}>
                  {level && <span className={`dot dot-${level}`} aria-label={`Key ${STEP_WORDS[level]}`} />}
                </span>
                <span className="row-name" title={t.name}>
                  {t.name}
                </span>
                <span className="row-bpm">{t.tempo ? fmt(t.tempo.bpm) : "–"}</span>
                <span className="row-key">{t.key ? t.key.camelot : "–"}</span>
                <span className="row-time">{t.duration ? formatTime(t.duration) : ""}</span>
                <span className="row-badge">{badge(t)}</span>
                <span className="row-tools">
                  <button type="button" aria-label={`Move ${t.name} up`} onClick={() => moveTrack(t.id, -1)} disabled={i === 0 || autoDj.on}>
                    ↑
                  </button>
                  <button type="button" aria-label={`Move ${t.name} down`} onClick={() => moveTrack(t.id, 1)} disabled={i === tracks.length - 1 || autoDj.on}>
                    ↓
                  </button>
                  <button type="button" aria-label={`Remove ${t.name}`} onClick={() => removeTrack(t.id)} disabled={isLiveRow}>
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {tracks.length > 0 && !autoDj.on && (
        <button type="button" className="link-btn" onClick={clearTracks}>
          Clear the playlist
        </button>
      )}
    </section>
  );
}

function fmt(bpm) {
  if (!(bpm > 0)) return "–";
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
