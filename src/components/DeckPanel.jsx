import { useRef, useState } from "react";
import { useDeck } from "./useDeck.js";
import { Waveform } from "./Waveform.jsx";
import { formatTime } from "../lib/mixer.js";
import { LOOP_BEATS } from "../lib/cues.js";

/**
 * One deck: load a track (button or drag and drop), see its waveform,
 * play, pause, cue, and set its volume.
 */
export function DeckPanel({ deck, title }) {
  useDeck(deck);
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function loadFile(file) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      await deck.load(file);
    } catch {
      setError("This file couldn't be read. Try an MP3 or WAV file.");
    } finally {
      setBusy(false);
    }
  }

  const loaded = Boolean(deck.buffer);
  const position = deck.position;
  const duration = deck.duration;
  const progress = duration ? position / duration : 0;

  return (
    <section
      className={`deck${dragging ? " deck-drop" : ""}`}
      aria-label={title}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void loadFile(e.dataTransfer.files?.[0]);
      }}
    >
      <header className="deck-head">
        <span className="deck-letter">{deck.id.toUpperCase()}</span>
        <div className="deck-track">
          <p className="deck-name" title={deck.name}>
            {busy ? "Reading track…" : loaded ? deck.name : "No track loaded"}
          </p>
          <p className="deck-time">
            {loaded ? (
              <>
                <span data-testid={`time-${deck.id}`}>{formatTime(position)}</span>
                <span className="muted"> / {formatTime(duration)}</span>
                <span className="muted"> · −{formatTime(duration - position)}</span>
              </>
            ) : (
              <span className="muted">Drop a track here or press Load</span>
            )}
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
          Load
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.flac,.aiff,.m4a,.ogg"
          hidden
          data-testid={`file-${deck.id}`}
          onChange={(e) => {
            void loadFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </header>

      <Readout deck={deck} loaded={loaded} />

      <Waveform
        peaks={deck.peaks}
        progress={progress}
        cue={duration ? deck.cue / duration : 0}
        hotCues={duration ? deck.hotCues.map((c) => (c === null ? null : c / duration)) : []}
        loop={duration && deck.loop ? { from: deck.loop.start / duration, to: deck.loop.end / duration } : null}
        onSeek={(f) => deck.seek(f)}
        label={loaded ? `Waveform of ${deck.name}. Click to jump.` : "Empty deck"}
      />

      {error && (
        <p className="deck-error" role="alert">
          {error}
        </p>
      )}

      <div className="deck-controls">
        <button
          type="button"
          className="btn btn-gold"
          onClick={() => deck.toggle()}
          disabled={!loaded}
          aria-pressed={deck.playing}
        >
          {deck.playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => deck.pressCue()}
          disabled={!loaded}
          title="Paused: sets the cue point here. Playing: jumps back to the cue point."
        >
          Cue
        </button>
        <label className="volume">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={deck.volume}
            onChange={(e) => deck.setVolume(Number(e.target.value))}
            aria-label={`Deck ${deck.id.toUpperCase()} volume`}
          />
        </label>
      </div>

      {loaded && <CueLoop deck={deck} />}
    </section>
  );
}

/**
 * Hot cues (tap an empty one to set it on the nearest beat, tap a set one to
 * jump there in time, × to clear) and beat loops (tap a length; tap it again
 * to let go; another length resizes it).
 */
function CueLoop({ deck }) {
  const id = deck.id;
  const hasTempo = Boolean(deck.analysis.tempo);
  return (
    <div className="cueloop">
      <div className="hotcues" role="group" aria-label={`Deck ${id.toUpperCase()} hot cues`}>
        {deck.hotCues.map((c, i) => (
          <span key={i} className={`hotcue${c === null ? " hotcue-empty" : ""}`}>
            <button
              type="button"
              onClick={() => deck.pressHotCue(i)}
              title={c === null ? "Set a hot cue here (on the nearest beat)" : `Jump to ${formatTime(c)}, in time`}
              data-testid={`hotcue-${id}-${i}`}
            >
              {c === null ? `+ ${i + 1}` : `${i + 1} · ${formatTime(c)}`}
            </button>
            {c !== null && (
              <button type="button" className="hotcue-x" onClick={() => deck.clearHotCue(i)} aria-label={`Clear hot cue ${i + 1}`} data-testid={`hotcue-x-${id}-${i}`}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="bars loops" role="group" aria-label={`Deck ${id.toUpperCase()} beat loops`}>
        {LOOP_BEATS.map((n) => (
          <button
            key={n}
            type="button"
            className={`bar-choice${deck.loop?.beats === n ? " bar-on loop-on" : ""}`}
            onClick={() => deck.setLoop(n)}
            disabled={!hasTempo}
            aria-pressed={deck.loop?.beats === n}
            title={deck.loop?.beats === n ? "Tap again to let go of the loop" : `Loop ${n === 0.5 ? "half a beat" : `${n} beat${n === 1 ? "" : "s"}`}`}
            data-testid={`loop-${id}-${n}`}
          >
            {n === 0.5 ? "½" : n}
          </button>
        ))}
        <span className="loop-label">{deck.loop ? "Looping" : "Loop"}</span>
      </div>
    </div>
  );
}

/** BPM and key boxes under the track name. "?" means not fully sure. */
function Readout({ deck, loaded }) {
  const { status, tempo, key } = deck.analysis;
  const id = deck.id;
  let bpmText = "–";
  let keyText = "–";
  let keySub = "";
  let bpmSub = "";
  if (loaded && status === "working") {
    bpmText = "…";
    keyText = "…";
  } else if (loaded && status === "failed") {
    bpmText = "Error";
    keyText = "Error";
  } else if (loaded && status === "done") {
    bpmText = tempo ? `${fmt(tempo.bpm)}${tempo.sure ? "" : "?"}` : "Not found";
    keyText = key ? `${key.camelot}${key.sure ? "" : "?"}` : "Not found";
    keySub = key ? key.name : "";
    // After a transition the deck may play at another tempo / key.
    if (tempo && Math.abs(deck.speed - 1) > 1e-6) bpmSub = `playing at ${fmt(deck.playingBpm)}`;
    if (key && deck.semitones) keySub = `${key.name} · shifted to ${deck.playingCamelot}`;
  }
  const unsure = status === "done" && ((tempo && !tempo.sure) || (key && !key.sure));
  const note =
    status === "working"
      ? "Reading tempo and key…"
      : status === "failed"
        ? "Couldn't read tempo or key from this file."
        : unsure
          ? key && !key.sure && key.alt
            ? `? = not fully sure. Key is a close call with ${key.alt.camelot} (${key.alt.name}): check it by ear.`
            : "? = not fully sure. Check it by ear."
          : "";

  return (
    <div className="readout-wrap">
      <div className="readout" aria-busy={status === "working"}>
        <p className="stat">
          <span className="stat-label">BPM</span>
          <span className="stat-value" data-testid={`bpm-${id}`}>
            {bpmText}
          </span>
          {bpmSub && <span className="stat-sub">{bpmSub}</span>}
        </p>
        <p className="stat">
          <span className="stat-label">Key</span>
          <span className="stat-value stat-key" data-testid={`key-${id}`}>
            {keyText}
          </span>
          {keySub && <span className="stat-sub">{keySub}</span>}
        </p>
      </div>
      <p className="readout-note" role="status">
        {note}
      </p>
    </div>
  );
}

function fmt(bpm) {
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
