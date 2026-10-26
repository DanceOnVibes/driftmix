import { useEffect, useReducer } from "react";
import { assessMatch } from "../lib/match.js";

const WORDS = { green: "Green", amber: "Amber", red: "Red" };

/** Redraw when a deck changes (track loaded, analysis done, play, pause). */
function useDeckChanges(deck) {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => deck.subscribe(refresh), [deck]);
}

/**
 * The match light: green, amber or red for the two loaded tracks, with the
 * tempo and key verdicts and what to do about them. The playing deck is "now";
 * the other is "next". If neither (or both) is playing, A counts as now.
 */
export function MatchPanel({ a, b }) {
  useDeckChanges(a);
  useDeckChanges(b);
  const [now, next] = b.playing && !a.playing ? [b, a] : [a, b];
  const m = assessMatch(now, next);
  const N = now.id.toUpperCase();
  const X = next.id.toUpperCase();
  const tempoText = m.tempo
    ? `${fmt(now.analysis.tempo.bpm)} → ${fmt(next.analysis.tempo.bpm)} · ${m.tempo.label}`
    : "–";
  const keyText = m.key ? `${now.analysis.key.camelot} → ${next.analysis.key.camelot} · ${m.key.label}` : "–";

  return (
    <section className={`match match-${m.level}`} aria-label="Match light" data-testid="match" data-level={m.level}>
      <div className="match-top">
        <span className="light" aria-hidden="true" />
        <div className="match-titles">
          <p className="match-head" role="status" data-testid="match-headline">
            {m.headline}
          </p>
          {m.level !== "waiting" && (
            <p className="match-sub">
              {N} now → {X} next
            </p>
          )}
        </div>
      </div>

      {m.level !== "waiting" && (
        <dl className="match-rows">
          <div>
            <dt>
              <span className={`dot dot-${m.tempo?.level ?? "none"}`} aria-hidden="true" />
              Tempo
            </dt>
            <dd data-testid="match-tempo">
              {m.tempo && <span className="visually-hidden">{WORDS[m.tempo.level]}: </span>}
              {tempoText}
            </dd>
          </div>
          <div>
            <dt>
              <span className={`dot dot-${m.key?.level ?? "none"}`} aria-hidden="true" />
              Key
            </dt>
            <dd data-testid="match-key">
              {m.key && <span className="visually-hidden">{WORDS[m.key.level]}: </span>}
              {keyText}
            </dd>
          </div>
        </dl>
      )}

      {m.tips.length > 0 && (
        <ul className="match-tips" data-testid="match-tips">
          {m.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmt(bpm) {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}
