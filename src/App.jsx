import { useEffect, useReducer } from "react";
import { DeckPanel } from "./components/DeckPanel.jsx";
import { MatchPanel } from "./components/MatchPanel.jsx";
import { TransitionPanel } from "./components/TransitionPanel.jsx";
import { AutoDjPanel } from "./components/AutoDjPanel.jsx";
import { decks, crossfader, setCrossfader } from "./audio/engine.js";

const SITE = "https://thedrift3r.com";
const SOURCE = "https://github.com/DanceOnVibes/driftmix";

export function App() {
  // The crossfader lives in the engine, so the transition can move it too.
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => crossfader.subscribe(refresh), []);
  useEffect(() => setCrossfader(0), []);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>DriftMix</h1>
          <a className="by" href={SITE}>
            by The Drift3r
          </a>
        </div>
        <p className="status">Version 1: two decks, BPM and key, match light, one-press transitions and Auto DJ.</p>
      </header>

      <main>
        <div className="decks">
          <DeckPanel deck={decks.a} title="Deck A" />
          <DeckPanel deck={decks.b} title="Deck B" />
        </div>

        <MatchPanel a={decks.a} b={decks.b} />
        <TransitionPanel />

        <section className="mixer" aria-label="Crossfader">
          <span className="mixer-end">A</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={crossfader.position}
            disabled={crossfader.locked}
            onChange={(e) => setCrossfader(Number(e.target.value))}
            onDoubleClick={() => setCrossfader(0)}
            aria-label="Crossfader: left is deck A, right is deck B"
            data-testid="crossfader"
          />
          <span className="mixer-end">B</span>
        </section>
        <p className="hint">
          {crossfader.locked
            ? "The transition is doing the fade. The crossfader is yours again when it ends."
            : "Double-click the crossfader to centre it. Mixing works best on a laptop."}
        </p>

        <AutoDjPanel />
      </main>

      <footer className="foot">
        <p className="promise">Your tracks never leave your computer. Nothing is uploaded.</p>
        <p>
          Free and open source (AGPL-3.0) · <a href={SOURCE}>Source code</a> · <a href={`${SITE}/privacy`}>Privacy</a>
        </p>
        <p className="muted">
          © {new Date().getFullYear()} DanceOnVibes Limited. Registered in England and Wales, company no. 17423769.
          Registered office: 167–169 Great Portland Street, London W1W 5PF, United Kingdom.
        </p>
      </footer>
    </div>
  );
}
