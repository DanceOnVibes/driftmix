import { useEffect, useReducer } from "react";
import { DeckPanel } from "./components/DeckPanel.jsx";
import { MatchPanel } from "./components/MatchPanel.jsx";
import { TransitionPanel } from "./components/TransitionPanel.jsx";
import { AutoDjPanel } from "./components/AutoDjPanel.jsx";
import { FilesPanel } from "./components/FilesPanel.jsx";
import { BoothPanel } from "./components/BoothPanel.jsx";
import { SamplerPanel } from "./components/SamplerPanel.jsx";
import { UpdateStrip, AppMenu } from "./components/AppBar.jsx";
import { decks, crossfader, setCrossfader } from "./audio/engine.js";
import { autoDj } from "./audio/autodj.js";
import { tabs, TABS, goTo } from "./audio/tabs.js";

const SITE = "https://thedrift3r.com";
const SOURCE = "https://github.com/DanceOnVibes/driftmix";

export function App() {
  // The crossfader lives in the engine, so the transition can move it too.
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => crossfader.subscribe(refresh), []);
  useEffect(() => tabs.subscribe(refresh), []);
  useEffect(() => setCrossfader(0), []);
  const tab = tabs.current;
  const group = (id) => `tab-group${tab === id ? " tab-on" : ""}`;

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
        <div className="top-right">
          <nav className="jump" aria-label="Sections">
            {TABS.slice(1).map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  goTo(t.id);
                }}
              >
                {t.id === "booth" ? "Vocal Booth" : t.label}
              </a>
            ))}
          </nav>
          <AppMenu />
        </div>
        <p className="status">Two decks, BPM and key, match light, one-press transitions, Auto DJ, Samples, Vocal Booth and Files.</p>
      </header>

      <main>
        <div className={group("decks")} data-tab="decks">
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
        </div>

        <div className={group("autodj")} data-tab="autodj">
          <AutoDjPanel />
        </div>
        <div className={group("samples")} data-tab="samples">
          <SamplerPanel />
        </div>
        <div className={group("booth")} data-tab="booth">
          <BoothPanel />
        </div>
        <div className={group("files")} data-tab="files">
          <FilesPanel />
        </div>
      </main>

      <TabBar />

      <footer className="foot">
        <p className="promise">Your tracks and your voice never leave your computer. Nothing is uploaded.</p>
        <p className="made-by">
          Made by The Drift3r · <a href={SITE}>thedrift3r.com</a>
        </p>
        <p>
          Free and open source (AGPL-3.0) · <a href={SOURCE}>Source code</a> · <a href="./privacy">Privacy</a> · More in the ⚙ menu
        </p>
        <p className="muted">
          © {new Date().getFullYear()} DanceOnVibes Limited. Registered in England and Wales, company no. 17423769.
          Registered office: 167–169 Great Portland Street, London W1W 5PF, United Kingdom.
        </p>
      </footer>
    </div>
  );
}

/** Phones: one section at a time, picked here. Everything keeps playing in the others. */
function TabBar() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => tabs.subscribe(refresh), []);
  useEffect(() => autoDj.subscribe(refresh), []);
  useEffect(() => decks.a.subscribe(refresh), []);
  useEffect(() => decks.b.subscribe(refresh), []);
  const tab = tabs.current;
  // A small dot on a tab when something is going on there that you can't see.
  const busy = { decks: decks.a.playing || decks.b.playing, autodj: autoDj.on };
  return (
    <nav className="tabbar" aria-label="Sections" data-testid="tabbar">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab${tab === t.id ? " tab-active" : ""}`}
          aria-current={tab === t.id ? "page" : undefined}
          onClick={() => goTo(t.id)}
          data-testid={`tab-${t.id}`}
        >
          {t.label}
          {busy[t.id] && tab !== t.id && <span className="tab-dot" aria-label="(playing)" />}
        </button>
      ))}
    </nav>
  );
}
