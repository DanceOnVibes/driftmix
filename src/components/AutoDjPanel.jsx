import { useEffect, useReducer, useRef, useState } from "react";
import { formatTime } from "../lib/mixer.js";
import { stepCost, ORDER_BY } from "../lib/setlist.js";
import { BAR_CHOICES } from "../lib/transition.js";
import { mix } from "../audio/transition.js";
import { decks } from "../audio/engine.js";
import { files, filesForAutoDj } from "../audio/files.js";
import { SetRecorder } from "./SetRecorder.jsx";
import { UndoStrip } from "./UndoStrip.jsx";
import { Fold } from "./Fold.jsx";
import { RekordboxExport } from "./RekordboxExport.jsx";
import { UsbCheck } from "./UsbCheck.jsx";
import { BridgesPanel } from "./BridgesPanel.jsx";
import { demo, playDemo } from "../audio/demo.js";
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
  setTempoChoice,
  skipReason,
  setBridge,
  needsBridge,
  setBuildUps,
  setOrderBy,
  undoClear,
} from "../audio/autodj.js";

const TEMPOS = [120, 122, 124, 125, 126, 128, 130, 132, 134, 136, 138, 140, 145, 150];

const STEP = { 0: "green", 2: "amber", 3: "amber", 4: "amber", 10: "red" };
const STEP_WORDS = { green: "flows", amber: "mixable", red: "clash" };

/**
 * Auto DJ: add tracks, order them, press Start. Each row shows the track's
 * tempo and key and how well it flows from the track before it.
 */
export function AutoDjPanel() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const offs = [autoDj.subscribe(refresh), mix.subscribe(refresh), decks.a.subscribe(refresh), decks.b.subscribe(refresh), files.subscribe(refresh), demo.subscribe(refresh)];
    return () => offs.forEach((off) => off());
  }, []);
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const tracks = autoDj.tracks;
  const firstBpm = tracks.find((t) => t.status === "ready" && t.tempo)?.tempo.bpm;
  const setBpm = autoDj.setBpm ?? setTempo();
  const ready = tracks.filter((t) => playable(t, setBpm));
  const readingCount = tracks.filter((t) => t.status === "reading").length;
  const length = setLength();
  const live = new Set([autoDj.onDeck.a, autoDj.onDeck.b].filter(Boolean));
  const fromFiles = filesForAutoDj();
  const hint = autoDj.on ? "" : whyNot({ tracks, ready, readingCount, setBpm });

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
    if (t.status === "failed") return "Can't read the file";
    if (!t.tempo) return "No steady beat";
    if (!playable(t, setBpm)) return `Too far: ${Math.round(Math.abs(skipPercent(t, setBpm)) * 10) / 10}%`;
    if (needsBridge(t, setBpm)) return "Echo-out bridge";
    return "";
  }

  return (
    <section
      className={`autodj${dragging ? " autodj-drop" : ""}`}
      id="autodj"
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
        {tracks.length === 0 && !autoDj.on && (demo.status === "ready" || demo.status === "loading") && (
          <button type="button" className="btn btn-gold" onClick={() => void playDemo()} disabled={demo.status === "loading"} data-testid="demo">
            {demo.status === "loading" ? "Loading the demo…" : `Hear a demo mix (${demo.tracks.length} tracks by The Drift3r)`}
          </button>
        )}
        {tracks.length === 0 && fromFiles.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => addTracks(filesForAutoDj())} data-testid="from-files">
            Use my {fromFiles.length} from Files
          </button>
        )}
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

      <Fold id="autodj-settings" summary={autoDjSummary(firstBpm)}>
        <div className="autodj-tools">
          <label className="tempo-choice">
            <span>Set tempo</span>
            <select
              value={String(autoDj.tempoChoice)}
              onChange={(e) => setTempoChoice(e.target.value)}
              disabled={autoDj.on}
              data-testid="set-tempo"
            >
              <option value="first">First track{firstBpm ? ` (${fmt(firstBpm)})` : ""}</option>
              <option value="journey">Journey: each its own</option>
              {TEMPOS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} BPM
                </option>
              ))}
            </select>
          </label>
          <label className="tempo-choice">
            <span>Order by</span>
            <select value={autoDj.orderBy} onChange={(e) => setOrderBy(e.target.value)} disabled={autoDj.on} data-testid="order-by">
              {Object.entries(ORDER_BY).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
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
          <label className="fcheck" title="When two tracks can't blend (tempos more than 6% apart, or keys that clash), echo the playing one out and drop the next on its own beat, instead of skipping it.">
            <input type="checkbox" checked={autoDj.bridge} onChange={(e) => setBridge(e.target.checked)} disabled={autoDj.on} data-testid="bridge-on" />
            <span>Echo-out bridge when tracks don't match</span>
          </label>
          <label className="tempo-choice" title="A build-up: a one-beat snippet rolls faster and faster with a riser, one beat of silence, and the next track drops. The snippet takes turns: a taste of the next track, then the last words of the one going out.">
            <span>Build-ups</span>
            <select value={autoDj.buildUps} onChange={(e) => setBuildUps(e.target.value)} disabled={autoDj.on} data-testid="buildups">
              <option value="off">Off (blends)</option>
              <option value="third">Every third mix</option>
              <option value="every">Every mix</option>
            </select>
          </label>
        </div>
      </Fold>
      <BridgesPanel />

      <p className="autodj-status" role="status" data-testid="autodj-status">
        {tracks.length === 0
          ? "No tracks yet. Press Add tracks, or drop a folder's worth of files here."
          : `${ready.length} of ${tracks.length} tracks ready${readingCount ? ` · reading ${readingCount}…` : ""}${
              setBpm ? ` · set tempo ${fmt(setBpm)} BPM` : autoDj.tempoChoice === "journey" ? " · tempo journey" : ""
            }${length ? ` · about ${formatTime(length)} of music` : ""}`}
      </p>
      {hint && (
        <p className="muted fnote" data-testid="autodj-hint">
          {hint}
        </p>
      )}
      {autoDj.message && (
        <p className="autodj-note" data-testid="autodj-note">
          {autoDj.message}
        </p>
      )}

      <SetRecorder />
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
                <span
                  className={`row-bpm${t.plan?.tempo !== 1 && t.tempo ? " row-set" : ""}`}
                  title={
                    t.plan?.tempo !== 1 && t.found?.tempo
                      ? `Exact BPM from Files (the file reads ${fmt(t.found.tempo.bpm)})`
                      : t.tempo && !t.tempo.sure
                        ? "Not fully sure: check by ear"
                        : ""
                  }
                  data-testid={`row-bpm-${i}`}
                >
                  {t.tempo ? `${fmt(t.tempo.bpm)}${t.tempo.sure ? "" : "?"}` : "–"}
                </span>
                <span
                  className={`row-key${t.plan?.semitones && t.key ? " row-set" : ""}`}
                  title={
                    t.plan?.semitones && t.found?.key
                      ? `Key shifted ${t.plan.semitones > 0 ? "+" : "−"}${Math.abs(t.plan.semitones)} in Files (the file is ${t.found.key.camelot})`
                      : t.key && !t.key.sure
                        ? t.key.alt
                          ? `Close call: maybe ${t.key.alt.camelot} (${t.key.alt.name})`
                          : "Not fully sure: check by ear"
                        : ""
                  }
                  data-testid={`row-key-${i}`}
                >
                  {t.key ? `${t.key.camelot}${t.key.sure ? "" : "?"}` : "–"}
                </span>
                <span className="row-time">{t.duration ? formatTime(t.duration) : ""}</span>
                <span className="row-badge" title={skipReason(t, setBpm)}>
                  {badge(t)}
                </span>
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
      <UndoStrip undo={autoDj.undo} onUndo={undoClear} testid="autodj-undo" />
      {tracks.length > 0 && <RekordboxExport />}
      <UsbCheck />
    </section>
  );
}

/** Why Order or Start is greyed out, in plain words ("" when both work). */
function whyNot({ tracks, ready, readingCount, setBpm }) {
  if (tracks.length === 0) return "";
  if (readingCount > 0) return "Reading BPM and key… Order and Start wake up when it's done.";
  if (ready.length >= 3) return "";
  const where = setBpm ? ` at ${fmt(setBpm)} BPM` : "";
  const fit = `${ready.length} track${ready.length === 1 ? "" : "s"} fit${ready.length === 1 ? "s" : ""} the set${where}`;
  if (ready.length === 2) return `${fit}: enough to Start, but Order needs 3. Add more tracks, or pick another Set tempo.`;
  const lead = ready.length === 0 ? `No tracks fit the set${where}` : `Only ${fit}`;
  return `${lead}. Start needs 2 and Order needs 3: add more tracks, pick another Set tempo, or move a different track to the top.`;
}

function skipPercent(track, setBpm) {
  // How far the track is from the set tempo (half/double time counts).
  const options = [1, 2, 0.5].map((f) => (Math.abs(setBpm - track.tempo.bpm * f) / (track.tempo.bpm * f)) * 100);
  return Math.min(...options);
}

function fmt(bpm) {
  if (!(bpm > 0)) return "–";
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** The folded Auto DJ settings in one line: "Tempo: first track · Flowing keys · 16 bars · bridge". */
function autoDjSummary(firstBpm) {
  const t = autoDj.tempoChoice;
  const tempo = t === "first" ? `first track${firstBpm ? ` (${fmt(firstBpm)})` : ""}` : t === "journey" ? "journey" : `${t} BPM`;
  return [
    `Tempo: ${tempo}`,
    ORDER_BY[autoDj.orderBy],
    `${autoDj.bars} bars`,
    autoDj.bridge ? "echo bridge" : "",
    autoDj.buildUps === "third" ? "build-up every third mix" : autoDj.buildUps === "every" ? "build-up every mix" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
