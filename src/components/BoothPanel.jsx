import { useEffect, useReducer, useRef } from "react";
import { formatTime } from "../lib/mixer.js";
import { KNOBS, PRESETS } from "../lib/booth/presets.js";
import { files } from "../audio/files.js";
import {
  booth,
  loadBeat,
  beatFromFiles,
  barSeconds,
  setFrom,
  setCountIn,
  micOn,
  micOff,
  setMonitor,
  measureDelay,
  setNudge,
  record,
  stopRecording,
  selectTake,
  deleteTake,
  clearTakes,
  play,
  stopPlayback,
  setKnob,
  setPreset,
  setLevel,
  setFormat,
  setEven,
  save,
} from "../audio/booth.js";

/**
 * Vocal Booth: pick a beat, turn the mic on, record takes over the beat,
 * polish the one you like (every setting visible), save.
 */
export function BoothPanel() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const offs = [booth.subscribe(refresh), files.subscribe(refresh)];
    return () => offs.forEach((off) => off());
  }, []);
  const beatRef = useRef(null);
  const b = booth.beat;
  const busy = booth.mode !== "idle";
  const recording = booth.mode === "recording" || booth.mode === "counting";
  const take = booth.takes.find((t) => t.id === booth.selected);
  const fromFiles = files.items.filter((it) => it.status !== "failed" && it.status !== "reading");
  const bar = barSeconds();
  const barNo = b ? Math.round((booth.from - (b.bpm ? b.firstBeat % bar : 0)) / bar) + 1 : 1;

  return (
    <section className="autodj booth" id="booth" aria-label="Vocal Booth" data-testid="booth">
      <header className="autodj-head">
        <h2>Vocal Booth</h2>
        <p className="muted">Sing over a beat: natural sound, lined up on the beat, every setting in view. Nothing is uploaded.</p>
      </header>
      <p className="booth-tip">
        Wear <strong>wired</strong> headphones while you sing. Bluetooth adds too much delay, and a speaker leaks the beat into your vocal.
      </p>

      <div className="fgrid">
        <fieldset className="fset">
          <legend>1 · Beat</legend>
          <div className="autodj-tools">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => beatRef.current?.click()}
              disabled={busy || booth.takes.length > 0}
              title={booth.takes.length ? "Save or clear your takes first: they belong to this beat" : ""}
            >
              Load beat
            </button>
            <input
              ref={beatRef}
              type="file"
              hidden
              accept="audio/*,.mp3,.wav,.flac,.aiff,.m4a,.ogg"
              data-testid="booth-beat-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadBeat(f);
                e.target.value = "";
              }}
            />
            {fromFiles.length > 0 && (
              <select
                className="booth-select"
                value=""
                onChange={(e) => e.target.value && beatFromFiles(e.target.value)}
                disabled={busy || booth.takes.length > 0}
                aria-label="Use a track from Files"
                data-testid="booth-beat-files"
              >
                <option value="">or one from Files…</option>
                {fromFiles.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="booth-beat" data-testid="booth-beat">
            {booth.beatStatus === "reading"
              ? "Reading the beat…"
              : b
                ? [b.name, b.bpm && `${fmt(b.bpm)} BPM`, b.camelot, formatTime(b.buffer.duration)].filter(Boolean).join(" · ")
                : "No beat yet. An instrumental works best."}
          </p>
          {b && (
            <label className="ff">
              <span>Start from</span>
              <span className="booth-from">
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, b.buffer.duration - 1)}
                  step={bar}
                  value={booth.from}
                  onChange={(e) => setFrom(Number(e.target.value))}
                  disabled={busy}
                  aria-label="Start recording from"
                  data-testid="booth-from"
                />
                <span className="muted">
                  {b.bpm ? `bar ${barNo} · ` : ""}
                  {formatTime(booth.from)}
                </span>
              </span>
            </label>
          )}
          <label className="fcheck">
            <input type="checkbox" checked={booth.countIn} onChange={(e) => setCountIn(e.target.checked)} disabled={busy} />
            <span>Count me in (4 clicks before the beat)</span>
          </label>
        </fieldset>

        <fieldset className="fset">
          <legend>2 · Microphone</legend>
          {booth.mic !== "on" ? (
            <button type="button" className="btn btn-ghost btn-small booth-start" onClick={() => void micOn()} disabled={booth.mic === "asking"} data-testid="booth-mic">
              {booth.mic === "asking" ? "Waiting for permission…" : "Turn the mic on"}
            </button>
          ) : (
            <>
              {booth.inputs.length > 1 && (
                <label className="ff">
                  <span>Mic</span>
                  <select value={booth.inputId} onChange={(e) => void micOn(e.target.value)} disabled={busy}>
                    {booth.inputs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="booth-meter" aria-label="Microphone level" data-testid="booth-meter">
                <span style={{ width: `${Math.max(0, Math.min(100, ((booth.level + 60) / 60) * 100))}%` }} className={booth.level > -1 ? "hot" : ""} />
              </div>
              <p className="fnote">
                {booth.level > -1 ? "Too loud: move back a little." : booth.level < -45 ? "Sing a line to check the level." : "Level is good."}
              </p>
              <label className="fcheck">
                <input type="checkbox" checked={booth.monitor} onChange={(e) => setMonitor(e.target.checked)} />
                <span>Hear my voice in the headphones (adds a little delay; headphones only)</span>
              </label>
            </>
          )}
          <p className="booth-delay" data-testid="booth-delay">
            Delay:{" "}
            {booth.latency
              ? booth.latency.how === "measured"
                ? `${booth.latency.ms} ms, measured`
                : `about ${booth.latency.ms} ms (estimate)`
              : "not known yet"}
            {booth.nudgeMs ? ` ${booth.nudgeMs > 0 ? "+" : "−"} ${Math.abs(booth.nudgeMs)} ms by ear` : ""}
          </p>
          <button type="button" className="btn btn-ghost btn-small booth-start" onClick={() => void measureDelay()} disabled={busy} data-testid="booth-measure">
            {booth.mode === "measuring" ? "Listening…" : "Measure the delay"}
          </button>
          <p className="fnote">To measure: headphones off, volume up, quiet room. It plays 8 clicks (about 7 seconds).</p>
          <label className="ff">
            <span>By ear</span>
            <span className="booth-from">
              <input type="range" min="-150" max="150" step="5" value={booth.nudgeMs} onChange={(e) => setNudge(e.target.value)} disabled={busy} aria-label="Fine-tune the delay" data-testid="booth-nudge" />
              <span className="muted">{booth.nudgeMs} ms</span>
            </span>
          </label>
          <p className="fnote">Voice sounds late against the beat? Move right. Early? Move left.</p>
          {booth.mic === "on" && (
            <button type="button" className="link-btn" onClick={micOff} disabled={busy}>
              Turn the mic off
            </button>
          )}
        </fieldset>
      </div>

      <div className="booth-rec">
        {recording ? (
          <button type="button" className="btn btn-silver booth-big" onClick={() => void stopRecording()} data-testid="booth-record">
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-gold booth-big" onClick={() => void record()} disabled={!b || busy} data-testid="booth-record">
            ● Record
          </button>
        )}
        <span className={`booth-clock${recording ? " on" : ""}`} data-testid="booth-clock">
          {booth.mode === "counting"
            ? "Count-in…"
            : booth.mode === "recording"
              ? `Recording · ${formatTime(Math.max(0, booth.clock))}`
              : booth.mode === "playing"
                ? `Playing · ${formatTime(Math.max(0, booth.clock))}`
                : booth.mode === "saving"
                  ? "Saving…"
                  : b
                    ? `Ready: records from ${formatTime(booth.from)}`
                    : "Load a beat to start"}
        </span>
      </div>

      {booth.takes.length > 0 && (
        <>
          <ol className="booth-takes" data-testid="booth-takes">
            {booth.takes.map((t, i) => (
              <li key={t.id} className={t.id === booth.selected ? "on" : ""}>
                <label className="fcheck">
                  <input type="radio" name="take" checked={t.id === booth.selected} onChange={() => selectTake(t.id)} disabled={busy} data-testid={`take-${i}`} />
                  <span>
                    Take {t.n} · {formatTime(t.from)} → {formatTime(t.from + t.seconds)}
                    {t.clipped && <em className="fwarn"> · too loud in places</em>}
                  </span>
                </label>
                <button type="button" aria-label={`Delete take ${t.n}`} onClick={() => deleteTake(t.id)} disabled={busy}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="link-btn" onClick={clearTakes} disabled={busy}>
            Clear all takes
          </button>
        </>
      )}

      {take && (
        <fieldset className="fset">
          <legend>3 · Polish take {take.n}</legend>
          <div className="autodj-tools">
            {booth.mode === "playing" ? (
              <button type="button" className="btn btn-silver" onClick={stopPlayback} data-testid="booth-play">
                Stop
              </button>
            ) : (
              <button type="button" className="btn btn-gold" onClick={play} disabled={busy} data-testid="booth-play">
                ▶ Play with the beat
              </button>
            )}
            <div className="bars" role="radiogroup" aria-label="Sound">
              {Object.entries(PRESETS).map(([id, p]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={booth.preset === id}
                  className={`bar-choice${booth.preset === id ? " bar-on" : ""}`}
                  onClick={() => setPreset(id)}
                  disabled={booth.mode === "saving" || recording}
                  data-testid={`preset-${id}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="booth-knobs">
            {KNOBS.map((k) => (
              <label key={k.id} className="booth-knob" title={k.help}>
                <span>
                  {k.label} <b>{booth.knobs[k.id]}{k.unit}</b>
                </span>
                <input
                  type="range"
                  min={k.min}
                  max={k.max}
                  step={k.step}
                  value={booth.knobs[k.id]}
                  onChange={(e) => setKnob(k.id, e.target.value)}
                  disabled={booth.mode === "saving" || recording}
                  data-testid={`knob-${k.id}`}
                />
                <small className="muted">{k.help}</small>
              </label>
            ))}
            <label className="booth-knob">
              <span>
                Vocal level <b>{signed(booth.vocalDb)} dB</b>
              </span>
              <input type="range" min="-24" max="12" step="0.5" value={booth.vocalDb} onChange={(e) => setLevel("vocal", e.target.value)} data-testid="level-vocal" />
              <small className="muted">0 = just above the beat (set for you)</small>
            </label>
            <label className="booth-knob">
              <span>
                Beat level <b>{signed(booth.beatDb)} dB</b>
              </span>
              <input type="range" min="-24" max="12" step="0.5" value={booth.beatDb} onChange={(e) => setLevel("beat", e.target.value)} data-testid="level-beat" />
              <small className="muted">Also how loud you hear it while recording</small>
            </label>
          </div>
        </fieldset>
      )}

      {take && (
        <fieldset className="fset">
          <legend>4 · Save</legend>
          <div className="autodj-tools">
            <label className="ff booth-inline">
              <span>Format</span>
              <select value={booth.format} onChange={(e) => setFormat(e.target.value)} disabled={busy} data-testid="booth-format">
                <option value="mp3">MP3 320 kbps</option>
                <option value="wav">WAV 24-bit</option>
              </select>
            </label>
            <label className="fcheck">
              <input type="checkbox" checked={booth.even} onChange={(e) => setEven(e.target.checked)} disabled={busy} />
              <span>Even out the mix for streaming (−14 LUFS)</span>
            </label>
          </div>
          <div className="autodj-tools">
            <button type="button" className="btn btn-gold" onClick={() => void save("mix")} disabled={busy} data-testid="save-mix">
              Save the mix
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void save("vocal")} disabled={busy} data-testid="save-vocal">
              Save vocal only
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void save("raw")} disabled={busy} data-testid="save-raw">
              Save raw take (WAV)
            </button>
          </div>
          <p className="fnote">
            The vocal files start at 0:00 of the beat, so in a music app they line up when both start at the beginning. "Raw" is exactly as recorded (lined
            up, nothing added), for editing elsewhere.
          </p>
          {booth.outputs.length > 0 && (
            <ul className="booth-outputs">
              {booth.outputs.map((o) => (
                <li key={o.url}>
                  <a href={o.url} download={o.name}>
                    {o.name}
                  </a>{" "}
                  <span className="muted">{(o.size / 1048576).toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      {booth.message && (
        <p className="autodj-note" role="status" data-testid="booth-message">
          {booth.message}
        </p>
      )}
    </section>
  );
}

function fmt(bpm) {
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function signed(db) {
  return db > 0 ? `+${db}` : String(db);
}
