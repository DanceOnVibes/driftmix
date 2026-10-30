import { useEffect, useReducer, useState } from "react";
import { decks, audioContext } from "../audio/engine.js";
import {
  mix,
  isActive,
  nowAndNext,
  transitionOptions,
  warmUp,
  startTransition,
  cancelTransition,
  startBridge,
  bridgeOptions,
  startBuildUp,
} from "../audio/transition.js";
import { BAR_CHOICES } from "../lib/transition.js";
import { sampler, setBuildUpFrom, buildUpChoice } from "../audio/sampler.js";

/** Redraw on any deck or transition change, and smoothly while one runs. */
function useLive() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const offs = [decks.a.subscribe(refresh), decks.b.subscribe(refresh), mix.subscribe(refresh), sampler.subscribe(refresh)];
    let frame = 0;
    let last = 0;
    const tick = (time) => {
      if (isActive() && time - last > 100) {
        last = time;
        refresh();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      offs.forEach((off) => off());
      cancelAnimationFrame(frame);
    };
  }, []);
}

/**
 * The transition button: choose 8, 16 or 32 bars, optionally fix the key,
 * press Mix. Shows what's happening while it runs.
 */
export function TransitionPanel() {
  useLive();
  const [bars, setBars] = useState(16);
  const [useFix, setUseFix] = useState(true);
  const [now, next] = nowAndNext();
  const N = now.id.toUpperCase();
  const X = next.id.toUpperCase();
  const opts = transitionOptions(now, next);
  const canBridge = bridgeOptions(now, next).ok;
  const state = mix.state;
  const active = isActive();
  const ready = mix.ready && mix.ready.id === next.id ? mix.ready.status : null;

  // Get the next track's stretched copy ready in the background.
  useEffect(() => {
    warmUp({ bars, useFix });
  });

  let progress = 0;
  let detail = "";
  if ((state.status === "waiting" || state.status === "blending") && state.when && state.buildUp) {
    const t = audioContext().currentTime;
    const elapsed = t - state.when;
    if (elapsed < 0) detail = `Starts in ${Math.max(0, -elapsed).toFixed(1)} s, on the phrase.`;
    else {
      progress = Math.min(1, elapsed / (state.end - state.when));
      detail = elapsed < state.swapAt ? `Building · ${X} drops in ${(state.swapAt - elapsed).toFixed(1)} s` : `${X} dropped · echoes ringing out`;
    }
  } else if ((state.status === "waiting" || state.status === "blending") && state.when && state.bridge) {
    const t = audioContext().currentTime;
    const elapsed = t - state.when;
    if (elapsed < 0) detail = `Starts in ${Math.max(0, -elapsed).toFixed(1)} s, on the phrase.`;
    else {
      progress = Math.min(1, elapsed / (state.end - state.when));
      detail = elapsed < state.swapAt ? `Echo building · ${X} drops in ${(state.swapAt - elapsed).toFixed(1)} s` : `${X} dropped · echoes ringing out`;
    }
  } else if ((state.status === "waiting" || state.status === "blending") && state.when) {
    const t = audioContext().currentTime;
    const elapsed = t - state.when;
    if (elapsed < 0) {
      detail = `Starts in ${Math.max(0, -elapsed).toFixed(1)} s, on the bar.`;
    } else {
      progress = Math.min(1, elapsed / state.blendSeconds);
      const barLength = state.blendSeconds / state.bars;
      const bar = Math.min(state.bars, Math.floor(elapsed / barLength) + 1);
      detail =
        `Bar ${bar} of ${state.bars} · ` +
        (elapsed < state.swapAt ? `bass swap at bar ${state.bars / 2 + 1}` : "bass swapped");
    }
  }

  const readiness = !opts.ok
    ? `${opts.reason}${canBridge && opts.reason.includes("6%") ? ` Echo out still works: ${X} drops on its own beat, at its own tempo.` : ""}`
    : ready === "working"
      ? `Getting ${X} ready to match ${fmt(now.playingBpm)} BPM…`
      : ready === "failed"
        ? `Couldn't prepare ${X} yet. Pressing Mix will try again.`
        : `Ready: ${X} comes in on the next bar at ${fmt(now.playingBpm)} BPM, blends over ${bars} bars and swaps the bass half way.`;

  const fixLabel = opts.fix
    ? `Fix the key: shift ${X} ${opts.fix.semitones > 0 ? "up" : "down"} ${Math.abs(opts.fix.semitones)} semitone${
        Math.abs(opts.fix.semitones) > 1 ? "s" : ""
      } (${next.analysis.key.camelot} → ${opts.fix.code})`
    : "";

  return (
    <section className="transition" aria-label="Transition" data-testid="transition" data-status={state.status}>
      <div className="transition-controls">
        <div className="bars" role="radiogroup" aria-label="Blend length">
          {BAR_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={bars === n}
              className={`bar-choice${bars === n ? " bar-on" : ""}`}
              onClick={() => setBars(n)}
              disabled={active}
            >
              {n} bars
            </button>
          ))}
        </div>

        {active ? (
          <button type="button" className="btn btn-ghost mix-btn" onClick={() => cancelTransition()} data-testid="mix">
            Cancel
          </button>
        ) : (
          <span className="mix-pair">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void startBridge({ why: "by hand" })}
              disabled={!canBridge}
              title="Echo out the playing track on the next phrase, with a riser, and drop the next one on its own beat. Works for any two tracks."
              data-testid="bridge"
            >
              Echo out
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const c = buildUpChoice();
                void startBuildUp({ bars: 8, from: c.from, snippet: c.snippet, useFix, phraseBars: 1 });
              }}
              disabled={!opts.ok}
              title="A one-beat snippet repeats faster and faster over 8 bars with a riser, one beat of silence, then the next track drops on its first beat."
              data-testid="buildup"
            >
              Build-up
            </button>
            <button
              type="button"
              className="btn btn-gold mix-btn"
              onClick={() => void startTransition({ bars, useFix })}
              disabled={!opts.ok}
              data-testid="mix"
            >
              Mix {N} → {X}
            </button>
          </span>
        )}
      </div>

      {opts.ok && !active && (
        <label className="tempo-choice">
          <span>Build-up snippet from</span>
          <select value={sampler.buildUpFrom} onChange={(e) => setBuildUpFrom(e.target.value)} data-testid="snippet-from">
            <option value="incoming">{X}, coming in (a taste of its hook)</option>
            <option value="outgoing">{N}, going out (its last words)</option>
            {sampler.pads.map((p, i) =>
              p ? (
                <option key={i} value={`pad:${i}`}>
                  Pad {i + 1}: {p.name}
                </option>
              ) : null,
            )}
          </select>
        </label>
      )}

      {opts.fix && !active && (
        <label className="fix">
          <input type="checkbox" checked={useFix} onChange={(e) => setUseFix(e.target.checked)} data-testid="fix" />
          <span>{fixLabel}</span>
        </label>
      )}

      {active && (
        <div className="progress" aria-hidden="true">
          <span style={{ width: `${progress * 100}%` }} />
          <i style={{ left: "50%" }} />
        </div>
      )}

      <p className="transition-status" role="status" data-testid="transition-status">
        {active ? [state.message, detail].filter(Boolean).join(" · ") : readiness}
      </p>
      {!active && state.message && (
        <p className="transition-last" data-testid="transition-last">
          {state.message}
        </p>
      )}
    </section>
  );
}

function fmt(bpm) {
  if (!(bpm > 0)) return "–";
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
