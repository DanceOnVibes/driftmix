import { useRef, useState } from "react";
import { useDeck } from "./useDeck.js";
import { Waveform } from "./Waveform.jsx";
import { formatTime } from "../lib/mixer.js";

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

      <Waveform
        peaks={deck.peaks}
        progress={progress}
        cue={duration ? deck.cue / duration : 0}
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
    </section>
  );
}
