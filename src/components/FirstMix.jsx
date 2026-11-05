import { useEffect, useReducer, useRef, useState } from "react";
import { decks } from "../audio/engine.js";
import { mix, heard } from "../audio/transition.js";
import { autoDj } from "../audio/autodj.js";
import { demo, demoOnDecks } from "../audio/demo.js";

const SAVED = "driftmix.firstMix"; // "done" | "hidden": not shown again

function remembered() {
  try {
    return localStorage.getItem(SAVED);
  } catch {
    return null;
  }
}
function remember(value) {
  try {
    localStorage.setItem(SAVED, value);
  } catch {
    /* private window: it just shows again next time */
  }
}

/**
 * The first mix, in three steps that tick themselves off: a track on A, a
 * track on B (the match light says if they fit), Play and Mix. Then a
 * moment to say what just happened. Shown until it's done or hidden.
 */
export function FirstMix() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  const [gone, setGone] = useState(() => remembered());
  const [mixed, setMixed] = useState(null); // { from, to, keys } once the first mix lands
  const seen = useRef(false);
  const box = useRef(null);
  // The moment is at the top of the decks: bring it into view (phones are scrolled down to Mix).
  useEffect(() => {
    if (mixed) box.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [mixed]);
  useEffect(() => {
    const offs = [decks.a.subscribe(refresh), decks.b.subscribe(refresh), autoDj.subscribe(refresh), demo.subscribe(refresh)];
    offs.push(
      mix.subscribe(() => {
        const s = mix.state;
        if (s.status === "blending") seen.current = true;
        if (s.status === "done" && seen.current && !autoDj.on && s.from && s.to) {
          seen.current = false;
          const from = decks[s.from];
          const to = decks[s.to];
          // The keys as they were heard (after any key fix), as the match light shows them.
          const a = heard(from).key?.camelot;
          const b = heard(to).key?.camelot;
          setMixed({ from: from.name, to: to.name, keys: a && b ? `${a} → ${b}` : "" });
        }
        refresh();
      }),
    );
    return () => offs.forEach((off) => off());
  }, []);

  if (gone || (autoDj.on && !mixed)) return null;

  const close = (how) => {
    remember(how);
    setGone(how);
  };

  if (mixed) {
    return (
      <section className="first-mix first-mix-done" aria-label="Your first mix" data-testid="first-mix" ref={box}>
        <p className="first-mix-head" role="status">
          You just mixed {mixed.from} into {mixed.to}, on the beat{mixed.keys ? ` (${mixed.keys})` : ""}.
        </p>
        <p className="muted first-mix-sub">That was the whole move. Next: try 8 bars for a quicker mix, or let Auto DJ play a whole set.</p>
        <div className="first-mix-actions">
          <button type="button" className="btn btn-gold btn-small" onClick={() => close("done")} data-testid="first-mix-close">
            Nice, close this
          </button>
        </div>
      </section>
    );
  }

  const steps = [
    { done: Boolean(decks.a.buffer), text: "Load a track on Deck A." },
    { done: Boolean(decks.b.buffer), text: "Load another on Deck B. The light under the decks tells you if they'll mix: green is good." },
    { done: false, text: "Press Play on the first, then Mix. DriftMix brings the next one in on the beat." },
  ];
  const at = steps.findIndex((s) => !s.done);

  return (
    <section className="first-mix" aria-label="Your first mix" data-testid="first-mix">
      <p className="first-mix-head">Your first mix, in three steps</p>
      <ol className="first-mix-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? "step-done" : i === at ? "step-now" : ""} data-done={s.done ? "yes" : "no"}>
            <span className="step-mark" aria-hidden="true">
              {s.done ? "✓" : i + 1}
            </span>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
      <div className="first-mix-actions">
        {demo.status !== "none" && demo.status !== "failed" && !decks.a.buffer && !decks.b.buffer && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void demoOnDecks()} disabled={demo.status === "loading"} data-testid="first-mix-demo">
            {demo.status === "loading" ? "Loading…" : "No tracks to hand? Use two demo tracks"}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-small" onClick={() => close("hidden")} data-testid="first-mix-hide">
          Hide
        </button>
      </div>
    </section>
  );
}
