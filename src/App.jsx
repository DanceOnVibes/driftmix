import { useEffect, useReducer } from "react";
import { DeckPanel } from "./components/DeckPanel.jsx";
import { MatchPanel } from "./components/MatchPanel.jsx";
import { TransitionPanel } from "./components/TransitionPanel.jsx";
import { AutoDjPanel } from "./components/AutoDjPanel.jsx";
import { FilesPanel } from "./components/FilesPanel.jsx";
import { BoothPanel } from "./components/BoothPanel.jsx";
import { SamplerPanel } from "./components/SamplerPanel.jsx";
import { UpdateStrip, InstallButton } from "./components/AppBar.jsx";
import { app } from "./audio/app.js";
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
      <UpdateStrip />
      <header className="top">
        <div className="brand">
          <h1>DriftMix</h1>
          <a className="by" href={SITE}>
            by The Drift3r
          </a>
        </div>
        <nav className="jump" aria-label="Sections">
          <a href="#autodj">Auto DJ</a>
          <a href="#samples">Samples</a>
          <a href="#booth">Vocal Booth</a>
          <a href="#files">Files</a>
          <InstallButton />
        </nav>
        <p className="status">Two decks, BPM and key, match light, one-press transitions, Auto DJ, Samples, Vocal Booth and Files.</p>
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
        <SamplerPanel />
        <BoothPanel />
        <FilesPanel />
      </main>

      <footer className="foot">
        <p className="promise">Your tracks and your voice never leave your computer. Nothing is uploaded.</p>
        <p>
          Free and open source (AGPL-3.0) · <a href={SOURCE}>Source code</a> · <a href={`${SITE}/privacy`}>Privacy</a> · MP3
          encoding by <a href="https://lame.sourceforge.io">LAME</a> (via lamejs, LGPL) · Version {app.version}
        </p>
        <p className="muted">
          © {new Date().getFullYear()} DanceOnVibes Limited. Registered in England and Wales, company no. 17423769.
          Registered office: 167–169 Great Portland Street, London W1W 5PF, United Kingdom.
        </p>
      </footer>
    </div>
  );
}
