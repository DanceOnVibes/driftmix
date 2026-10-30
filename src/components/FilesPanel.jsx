import { useEffect, useReducer, useRef, useState } from "react";
import { formatTime } from "../lib/mixer.js";
import { MP3_BITRATES } from "../lib/files/mp3.js";
import {
  files,
  addFiles,
  removeItem,
  moveItem,
  setTitle,
  clearAll,
  setSetting,
  setCommon,
  setCover,
  convertAll,
  buildZip,
  canShareFiles,
  shareDone,
  nameFor,
  targetRate,
  filesForAutoDj,
  planFor,
  setTarget,
  setShift,
  roundAll,
  BPM_SAFE,
} from "../audio/files.js";
import { shiftCamelot } from "../lib/match.js";
import { autoDj, addTracks } from "../audio/autodj.js";

const STATUS = { reading: "Reading…", ready: "Ready", converting: "Converting", done: "Done", failed: "Can't read", error: "Failed" };

/**
 * Files: convert, tag and tidy tracks (format, sample rate, channels, bit
 * rate, titles, cover, loudness, silence), then download one, all, or share.
 */
export function FilesPanel() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const offs = [files.subscribe(refresh), autoDj.subscribe(refresh)];
    return () => offs.forEach((off) => off());
  }, []);
  const inputRef = useRef(null);
  const coverRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [zip, setZip] = useState(null);
  const s = files.settings;
  const c = files.common;
  const items = files.items;
  const done = items.filter((it) => it.status === "done");
  const waiting = items.filter((it) => it.status === "ready" || it.status === "error");
  const reading = items.some((it) => it.status === "reading");
  const share = canShareFiles();

  useEffect(() => {
    if (!files.zipUrl) setZip(null);
  });

  const field = (label, key, placeholder) => (
    <label className="ff">
      <span>{label}</span>
      <input type="text" value={c[key]} placeholder={placeholder} onChange={(e) => setCommon(key, e.target.value)} disabled={files.busy} data-testid={`tag-${key}`} />
    </label>
  );

  return (
    <section
      className={`filesp${dragging ? " autodj-drop" : ""}`}
      id="files"
      aria-label="Files"
      data-testid="files"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <header className="autodj-head">
        <h2>Files</h2>
        <p className="muted">Convert, tag and tidy your tracks: format, sample rate, channels, bit rate, titles, cover and loudness. Everything happens on this device.</p>
      </header>

      <div className="autodj-tools">
        <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()} disabled={files.busy}>
          Add files
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={roundAll}
          disabled={files.busy || !items.some((it) => it.analysis?.bpm)}
          title="Set every track to its nearest whole BPM, e.g. 132.1 → 132"
          data-testid="round-all"
        >
          Round every BPM
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept="audio/*,.mp3,.wav,.flac,.aiff,.m4a,.ogg"
          data-testid="files-input"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="fgrid">
        <fieldset className="fset">
          <legend>Output</legend>
          <label className="ff">
            <span>Format</span>
            <select value={s.format} onChange={(e) => setSetting("format", e.target.value)} disabled={files.busy} data-testid="opt-format">
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
            </select>
          </label>
          {s.format === "mp3" ? (
            <label className="ff">
              <span>Bit rate</span>
              <select value={s.bitrate} onChange={(e) => setSetting("bitrate", Number(e.target.value))} disabled={files.busy} data-testid="opt-bitrate">
                {[...MP3_BITRATES].reverse().map((k) => (
                  <option key={k} value={k}>
                    {k} kbps{k === 320 ? " (best)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="ff">
              <span>Bit depth</span>
              <select value={s.bitDepth} onChange={(e) => setSetting("bitDepth", Number(e.target.value))} disabled={files.busy} data-testid="opt-bitdepth">
                <option value={16}>16-bit (CD)</option>
                <option value={24}>24-bit (studio)</option>
              </select>
            </label>
          )}
          <label className="ff">
            <span>Sample rate</span>
            <select value={s.sampleRate} onChange={(e) => setSetting("sampleRate", e.target.value)} disabled={files.busy} data-testid="opt-rate">
              <option value="original">Keep original</option>
              <option value="44100">44.1 kHz (music)</option>
              <option value="48000">48 kHz (video)</option>
            </select>
          </label>
          <label className="ff">
            <span>Channels</span>
            <select value={s.channels} onChange={(e) => setSetting("channels", e.target.value)} disabled={files.busy} data-testid="opt-channels">
              <option value="stereo">Stereo</option>
              <option value="mono">Mono</option>
            </select>
          </label>
          <label className="ff">
            <span>Loudness</span>
            <select value={s.loudness} onChange={(e) => setSetting("loudness", e.target.value)} disabled={files.busy} data-testid="opt-loudness">
              <option value="off">Leave as it is</option>
              <option value="-14">Even out: streaming (−14 LUFS)</option>
              <option value="-9">Even out: club (−9 LUFS)</option>
            </select>
          </label>
          <label className="fcheck">
            <input type="checkbox" checked={s.trim} onChange={(e) => setSetting("trim", e.target.checked)} disabled={files.busy} data-testid="opt-trim" />
            <span>Trim silence at the start and end</span>
          </label>
        </fieldset>

        <fieldset className="fset">
          <legend>Tags (same for every file)</legend>
          {field("Artist", "artist", "e.g. DanceOnVibes – The Drift3r")}
          {field("Album", "album", "e.g. 128 to 135")}
          {field("Year", "year", "2026")}
          {field("Genre", "genre", "e.g. Progressive House")}
          {field("Copyright", "copyright", "All rights reserved")}
          {field("Comment", "comment", "e.g. Lyrics: … · Audio: AI-assisted")}
          <div className="fcover">
            <span>Cover</span>
            {files.cover ? <img src={files.cover.url} alt="Cover" width="56" height="56" /> : <span className="muted">None</span>}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => coverRef.current?.click()} disabled={files.busy}>
              {files.cover ? "Change" : "Add cover"}
            </button>
            {files.cover && (
              <button type="button" className="link-btn" onClick={() => void setCover(null)} disabled={files.busy}>
                Remove
              </button>
            )}
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              hidden
              data-testid="cover-input"
              onChange={(e) => {
                void setCover(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <label className="fcheck">
            <input type="checkbox" checked={s.numbering} onChange={(e) => setSetting("numbering", e.target.checked)} disabled={files.busy} />
            <span>Number the tracks in list order</span>
          </label>
          <label className="fcheck">
            <input type="checkbox" checked={s.infoInName} onChange={(e) => setSetting("infoInName", e.target.checked)} disabled={files.busy} />
            <span>Put BPM and key in the file name</span>
          </label>
          <p className="muted fnote">BPM and key are also written into the tags, where DJ apps read them.</p>
        </fieldset>
      </div>

      {items.length === 0 ? (
        <p className="autodj-status">No files yet. Press Add files, or drop them here.</p>
      ) : (
        <ol className="flist" data-testid="files-list">
          {items.map((it, i) => (
            <li key={it.id} className={`frow frow-${it.status}`}>
              <span className="row-n">{s.numbering ? i + 1 : ""}</span>
              <div className="fmain">
                <input
                  className="ftitle"
                  value={it.title}
                  onChange={(e) => setTitle(it.id, e.target.value)}
                  disabled={files.busy}
                  aria-label={`Title of track ${i + 1}`}
                  data-testid={`title-${i}`}
                />
                <p className="fmeta">
                  {describe(it)}
                  {it.status !== "reading" && it.status !== "failed" && (
                    <span className="muted">
                      {" "}
                      → {s.format.toUpperCase()} {targetRate(it) / 1000} kHz {s.channels} {s.format === "mp3" ? `${s.bitrate} kbps` : `${s.bitDepth}-bit`}
                      {planFor(it).changed && ` · ${[planFor(it).bpm && `${fmt(planFor(it).bpm)} BPM`, planFor(it).camelot].filter(Boolean).join(" · ")}`}
                    </span>
                  )}
                </p>
                <p className="fname muted" title={nameFor(it, i)}>
                  {it.output ? it.output.name : nameFor(it, i)}
                </p>
                {it.analysis?.bpm && it.status !== "failed" && <Retune it={it} index={i} busy={files.busy} />}
                {it.note && <p className="fnote">{it.note}</p>}
                {it.status === "converting" && (
                  <div className="progress" aria-hidden="true">
                    <span style={{ width: `${Math.round(it.progress * 100)}%` }} />
                  </div>
                )}
              </div>
              <span className="fstatus" data-testid={`status-${i}`}>
                {it.status === "converting" ? `${Math.round(it.progress * 100)}%` : STATUS[it.status]}
                {it.output && <small>{mb(it.output.size)}</small>}
              </span>
              <span className="row-tools">
                {it.output && (
                  <a className="btn btn-gold btn-small" href={it.output.url} download={it.output.name} data-testid={`download-${i}`}>
                    Save
                  </a>
                )}
                <button type="button" aria-label={`Move ${it.title} up`} onClick={() => moveItem(it.id, -1)} disabled={i === 0 || files.busy}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${it.title} down`} onClick={() => moveItem(it.id, 1)} disabled={i === items.length - 1 || files.busy}>
                  ↓
                </button>
                <button type="button" aria-label={`Remove ${it.title}`} onClick={() => removeItem(it.id)} disabled={files.busy}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {items.length > 0 && (
        <div className="factions">
          <button type="button" className="btn btn-gold" onClick={() => void convertAll()} disabled={files.busy || reading || !waiting.length} data-testid="convert">
            {files.busy ? "Converting…" : `Convert ${waiting.length || ""}`.trim()}
          </button>
          {done.length > 0 && !zip && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => setZip(await buildZip())}
              disabled={files.busy}
              data-testid="make-zip"
            >
              Download all ({done.length})
            </button>
          )}
          {zip && (
            <a className="btn btn-ghost" href={zip.url} download={zip.name} data-testid="zip-link">
              Save {zip.name}
            </a>
          )}
          {share && done.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => void shareDone()} disabled={files.busy}>
              Share
            </button>
          )}
          {!autoDj.on && items.some((it) => it.status !== "failed") && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const { added, updated } = addTracks(filesForAutoDj());
                const plural = (n) => `${n} track${n === 1 ? "" : "s"}`;
                files.message = [added ? `${plural(added)} sent to Auto DJ.` : "", updated ? `${plural(updated)} already there, now up to date with your BPM, key and titles.` : ""]
                  .filter(Boolean)
                  .join(" ") || "Nothing new to send.";
                files.emit();
                document.getElementById("autodj")?.scrollIntoView({ behavior: "smooth" });
              }}
              data-testid="to-autodj"
            >
              Send to Auto DJ
            </button>
          )}
          {!files.busy && (
            <button type="button" className="link-btn" onClick={clearAll}>
              Clear the list
            </button>
          )}
        </div>
      )}
      {files.message && (
        <p className="autodj-note" role="status" data-testid="files-message">
          {files.message}
        </p>
      )}
      {reading && <p className="muted fnote">Reading BPM and key for each file…</p>}
    </section>
  );
}

/**
 * Exact BPM and key shift for one track, with what it means: how big the
 * change is, and whether the track's own tempo wanders.
 */
function Retune({ it, index, busy }) {
  const plan = planFor(it);
  const a = it.analysis;
  const commit = (e) => setTarget(it.id, e.target.value);
  const big = Math.abs(plan.percent) > BPM_SAFE;
  const st = it.steady;
  return (
    <div className="fretune">
      <label className="fsmall">
        <span>Exact BPM</span>
        <input
          key={`${it.id}-${it.targetBpm}`}
          type="text"
          inputMode="decimal"
          defaultValue={it.targetBpm ?? ""}
          placeholder={fmt(a.bpm)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          disabled={busy}
          aria-label={`Exact BPM for ${it.title}`}
          data-testid={`bpm-in-${index}`}
        />
      </label>
      {a.camelot && (
        <label className="fsmall">
          <span>Key</span>
          <select value={it.semitones} onChange={(e) => setShift(it.id, e.target.value)} disabled={busy} data-testid={`shift-${index}`}>
            {[-2, -1, 0, 1, 2].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? `Keep (${a.camelot})` : `${n > 0 ? "+" : "−"}${Math.abs(n)} → ${shiftCamelot(a.camelot, n)}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className={`fchange${big ? " fwarn" : ""}`} data-testid={`change-${index}`}>
        {plan.tempo !== 1 && `${fmt(a.bpm)} → ${fmt(plan.bpm)} BPM (${plan.percent > 0 ? "+" : "−"}${Math.abs(plan.percent).toFixed(1)}%)`}
        {big && " · a big change: vocals may sound off"}
      </span>
      {st && st.level !== "unknown" && (
        <span className={`fchange${st.level === "wanders" ? " fwarn" : ""}`} data-testid={`steady-${index}`}>
          {st.level === "steady"
            ? "Steady tempo ✓"
            : st.level === "slight"
              ? `Tempo drifts a little (${fmt(st.min)}–${fmt(st.max)}): fine`
              : `Tempo wanders ${fmt(st.min)}–${fmt(st.max)} BPM: exact BPM sets the average, it can't straighten it`}
        </span>
      )}
    </div>
  );
}

function fmt(bpm) {
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function describe(it) {
  const i = it.info;
  const parts = [];
  if (i) {
    parts.push(i.format);
    if (i.sampleRate) parts.push(`${i.sampleRate / 1000} kHz`);
    if (i.channels) parts.push(i.channels === 1 ? "mono" : "stereo");
    if (i.bitrate) parts.push(`${i.bitrate} kbps`);
    if (i.bitDepth) parts.push(`${i.bitDepth}-bit`);
  }
  if (it.duration) parts.push(formatTime(it.duration));
  const a = it.analysis;
  if (a?.bpm) parts.push(`${Math.round(a.bpm * 10) / 10}${a.bpmSure ? "" : "?"} BPM`);
  if (a?.camelot) parts.push(`${a.camelot}${a.keySure ? "" : a.keyAlt ? `? (or ${a.keyAlt})` : "?"}`);
  return parts.join(" · ") || "…";
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
