import { useEffect, useReducer, useRef } from "react";
import { decks } from "../audio/engine.js";
import {
  sampler,
  PAD_COUNT,
  setDeck,
  setStart,
  nudge,
  setBeats,
  setSnap,
  setCutLow,
  currentStart,
  sampleSeconds,
  whyNotSample,
  startPreview,
  stopPreview,
  saveToPad,
  clearPad,
  firePad,
  stopPad,
  padFile,
  allPadsZip,
  setBuildUpFrom,
} from "../audio/sampler.js";
import { SAMPLE_BEATS } from "../lib/sampler.js";

/**
 * Samples: cut a loop or one-shot from a track on a deck, exactly on the
 * beat; play it on the pads over the mix, use it in a Build-up, or save it
 * as a WAV for a USB stick.
 */
export function SamplerPanel() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const offs = [sampler.subscribe(refresh), decks.a.subscribe(refresh), decks.b.subscribe(refresh)];
    return () => offs.forEach((off) => off());
  }, []);

  // Keys 1–8 play the pads (not while typing in a box).
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const n = Number(e.key);
      if (n >= 1 && n <= PAD_COUNT && sampler.pads[n - 1]) {
        e.preventDefault();
        void firePad(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const deck = decks[sampler.deck];
  const t = deck.analysis.tempo;
  const why = whyNotSample();
  const start = why ? 0 : currentStart();
  const length = why ? 0 : sampleSeconds();
  const hasPads = sampler.pads.some(Boolean);

  return (
    <section className="sampler" id="samples" aria-label="Samples" data-testid="sampler">
      <header className="autodj-head">
        <h2>Samples</h2>
        <p className="muted">
          Cut a loop or a one-shot from a track on a deck, exactly on the beat. Play it on the pads over your mix, use it in a Build-up, or save it as a WAV
          for your USB stick: it loops cleanly with Beat Loop on a CDJ or XDJ.
        </p>
      </header>

      <div className="autodj-tools">
        <div className="bars" role="radiogroup" aria-label="Cut from">
          {["a", "b"].map((id) => (
            <button key={id} type="button" role="radio" aria-checked={sampler.deck === id} className={`bar-choice${sampler.deck === id ? " bar-on" : ""}`} onClick={() => setDeck(id)} data-testid={`sample-deck-${id}`}>
              Deck {id.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="bars" role="radiogroup" aria-label="Sample length">
          {SAMPLE_BEATS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={sampler.beats === n} className={`bar-choice${sampler.beats === n ? " bar-on" : ""}`} onClick={() => setBeats(n)} data-testid={`sample-beats-${n}`}>
              {n === 0.5 ? "½ beat" : `${n} ${n === 1 ? "beat" : "beats"}`}
            </button>
          ))}
        </div>
        <div className="bars" role="radiogroup" aria-label="Snap to">
          {[
            [1, "Beat"],
            [0.5, "½ beat"],
          ].map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={sampler.snap === v} className={`bar-choice${sampler.snap === v ? " bar-on" : ""}`} onClick={() => setSnap(v)}>
              Snap: {label}
            </button>
          ))}
        </div>
        <label className="fcheck" title="Filters out everything below 250 Hz: leaves the voice, leads and hats, so the sample sits on top of any track.">
          <input type="checkbox" checked={sampler.cutLow} onChange={(e) => setCutLow(e.target.checked)} data-testid="sample-cutlow" />
          <span>Cut bass and kick</span>
        </label>
      </div>

      {why ? (
        <p className="autodj-status" data-testid="sample-why">
          {why}
        </p>
      ) : (
        <>
          <p className="autodj-status" data-testid="sample-where">
            {deck.name}: {fmtTime(start)} for {sampler.beats === 0.5 ? "half a beat" : `${sampler.beats} beat${sampler.beats === 1 ? "" : "s"}`} ({length.toFixed(2)} s at {fmt(t.bpm)} BPM
            {deck.analysis.key ? `, ${deck.analysis.key.camelot}` : ""}). Tap the waveform to move it; it snaps to the beat.
          </p>
          <SampleWave deck={deck} start={start} length={length} />
          <div className="autodj-tools">
            <button type="button" className="btn btn-ghost" onClick={() => nudge(-1)} aria-label="Move the sample earlier" data-testid="sample-earlier">
              ◀
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => nudge(1)} aria-label="Move the sample later" data-testid="sample-later">
              ▶
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => (sampler.previewing === "once" ? stopPreview() : startPreview("once"))} data-testid="sample-play">
              {sampler.previewing === "once" ? "Stop" : "Play once"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => (sampler.previewing === "loop" ? stopPreview() : startPreview("loop"))} data-testid="sample-loop">
              {sampler.previewing === "loop" ? "Stop loop" : "Loop it"}
            </button>
            <button type="button" className="btn btn-gold" onClick={() => saveToPad()} data-testid="sample-save">
              Save to {sampler.pads.indexOf(null) >= 0 ? `pad ${sampler.pads.indexOf(null) + 1}` : "pad 1 (replaces it)"}
            </button>
          </div>
        </>
      )}

      <ol className="pads" data-testid="pads">
        {sampler.pads.map((p, i) => (
          <li key={i} className={`pad-cell${sampler.playing.has(i) ? " pad-on" : ""}`}>
            {p ? (
              <>
                <button type="button" className="pad" onClick={() => void firePad(i)} data-testid={`pad-${i}`} title={`Plays on the next beat. Key ${i + 1} plays it too.`}>
                  <span className="pad-n">{i + 1}</span>
                  <span className="pad-name">{p.name}</span>
                  <span className="pad-info">
                    {fmt(p.bpm)} BPM{p.camelot ? ` · ${p.camelot}` : ""}
                    {p.cutLow ? " · no bass" : ""}
                  </span>
                </button>
                <span className="pad-tools">
                  <button type="button" onClick={() => void firePad(i, { loop: true })} data-testid={`pad-loop-${i}`} aria-label={`Loop pad ${i + 1}`}>
                    {sampler.playing.has(i) ? "■" : "⟳"}
                  </button>
                  <button type="button" onClick={() => download(padFile(i))} data-testid={`pad-wav-${i}`} aria-label={`Save pad ${i + 1} as a WAV`}>
                    WAV
                  </button>
                  <button
                    type="button"
                    className={sampler.buildUpFrom === `pad:${i}` ? "pad-picked" : ""}
                    onClick={() => setBuildUpFrom(sampler.buildUpFrom === `pad:${i}` ? "incoming" : `pad:${i}`)}
                    data-testid={`pad-buildup-${i}`}
                    aria-label={`Use pad ${i + 1} in the next Build-up`}
                    aria-pressed={sampler.buildUpFrom === `pad:${i}`}
                  >
                    Build-up
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopPad(i);
                      clearPad(i);
                    }}
                    aria-label={`Clear pad ${i + 1}`}
                  >
                    ×
                  </button>
                </span>
              </>
            ) : (
              <span className="pad pad-empty">
                <span className="pad-n">{i + 1}</span>
                <span className="pad-name muted">Empty</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {hasPads && (
        <div className="autodj-tools">
          <button type="button" className="btn btn-ghost" onClick={() => download(allPadsZip())} data-testid="pads-zip">
            Save all pads (zip)
          </button>
        </div>
      )}
      {sampler.message && (
        <p className="autodj-note" role="status" data-testid="sampler-message">
          {sampler.message}
        </p>
      )}
    </section>
  );
}

/**
 * The part of the track around the sample: beats and bars marked, the
 * sample in gold. Above it, the whole track (tap to jump anywhere).
 */
function SampleWave({ deck, start, length }) {
  const detailRef = useRef(null);
  const overviewRef = useRef(null);
  const [size, resized] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  const t = deck.analysis.tempo;
  const beat = 60 / t.bpm;
  // 8 bars on screen, starting on the bar a bar before the sample.
  const bar = 4 * beat;
  const w0 = Math.max(0, t.firstBeat + (Math.floor((start - t.firstBeat) / bar) - 1) * bar);
  const w1 = Math.min(deck.duration, w0 + 8 * bar);

  useEffect(() => {
    const draw = (canvas, fn) => {
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      fn(ctx, width, height);
    };
    // Overview: the whole track, the window and the sample marked.
    draw(overviewRef.current, (ctx, width, height) => {
      const peaks = deck.peaks;
      const mid = height / 2;
      if (peaks) {
        const bars = peaks.max.length;
        ctx.fillStyle = "rgba(212, 166, 74, 0.4)";
        for (let x = 0; x < width; x++) {
          const i = Math.min(bars - 1, Math.floor((x / width) * bars));
          const top = mid - peaks.max[i] * mid * 0.9;
          const bottom = mid - peaks.min[i] * mid * 0.9;
          ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.strokeRect((w0 / deck.duration) * width + 0.5, 0.5, Math.max(2, ((w1 - w0) / deck.duration) * width), height - 1);
    });
    // Detail: min/max per pixel straight from the audio.
    draw(detailRef.current, (ctx, width, height) => {
      const b = deck.buffer;
      const d0 = b.getChannelData(0);
      const d1 = b.numberOfChannels > 1 ? b.getChannelData(1) : d0;
      const sr = b.sampleRate;
      const mid = height / 2;
      const span = w1 - w0;
      // The sample.
      ctx.fillStyle = "rgba(212, 166, 74, 0.22)";
      ctx.fillRect(((start - w0) / span) * width, 0, (length / span) * width, height);
      for (let x = 0; x < width; x++) {
        const a = Math.floor((w0 + (x / width) * span) * sr);
        const z = Math.min(d0.length, Math.floor((w0 + ((x + 1) / width) * span) * sr));
        let lo = 0;
        let hi = 0;
        for (let i = a; i < z; i += 4) {
          const v = (d0[i] + d1[i]) / 2;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const inside = w0 + (x / width) * span >= start && w0 + (x / width) * span < start + length;
        ctx.fillStyle = inside ? "#f3cf7a" : "rgba(212, 166, 74, 0.45)";
        ctx.fillRect(x, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95));
      }
      // Beats (faint) and bars (brighter).
      const first = Math.ceil((w0 - t.firstBeat) / beat - 1e-9);
      for (let k = first; t.firstBeat + k * beat <= w1; k++) {
        const x = Math.round(((t.firstBeat + k * beat - w0) / span) * width) + 0.5;
        ctx.fillStyle = k % 4 === 0 ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.12)";
        ctx.fillRect(x, 0, 1, height);
      }
      // Sample edges.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(Math.round(((start - w0) / span) * width), 0, 2, height);
      ctx.fillRect(Math.round(((start + length - w0) / span) * width) - 1, 0, 2, height);
    });
  }, [deck, deck.buffer, start, length, w0, w1, size]);

  const at = (e, ref, from, to) => {
    const rect = ref.current.getBoundingClientRect();
    return from + ((e.clientX - rect.left) / rect.width) * (to - from);
  };

  return (
    <div className="sample-wave">
      <canvas
        ref={overviewRef}
        className="sample-overview"
        role="img"
        aria-label={`${deck.name}: the whole track. Tap to move the sample there.`}
        onPointerDown={(e) => setStart(at(e, overviewRef, 0, deck.duration))}
        data-testid="sample-overview"
      />
      <canvas
        ref={detailRef}
        className="sample-detail"
        role="img"
        aria-label="Eight bars around the sample, beats marked. Tap to set where it starts."
        onPointerDown={(e) => setStart(at(e, detailRef, w0, w1))}
        data-testid="sample-detail"
      />
    </div>
  );
}

function download(file) {
  if (!file) return;
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function fmt(bpm) {
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, "0")}`;
}
