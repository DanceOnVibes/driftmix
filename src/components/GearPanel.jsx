import { useEffect, useReducer, useState } from "react";
import { Knob } from "./Knob.jsx";
import { Fold } from "./Fold.jsx";
import { headphones, setHeadphoneMode, setCueMix, setHeadphoneVolume, findOutputs } from "../audio/headphones.js";
import { controller, connectController, learn, forget, forgetAll, usePreset, presetInUse, watchMessages } from "../audio/controller.js";
import { TARGETS, controlLabel } from "../lib/midi.js";
import { decks } from "../audio/engine.js";

function useStore(store) {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => store.subscribe(refresh), [store]);
}

/** Headphones: where they come out, cue/master blend, volume. */
export function HeadphonesPanel() {
  useStore(headphones);
  useStore(decks.a);
  useStore(decks.b);
  useEffect(() => {
    void findOutputs();
  }, []);
  const h = headphones;
  const on = [decks.a, decks.b].filter((d) => d.headphones).map((d) => d.id.toUpperCase());
  return (
    <section className="gear" aria-label="Headphones" data-testid="headphones-panel">
      <div className="gear-head">
        <h3>🎧 Headphones</h3>
        <span className="muted">{h.mode === "off" ? "Off" : on.length ? `Listening to deck ${on.join(" + ")}` : "Press 🎧 on a deck to hear it here"}</span>
      </div>
      <div className="gear-row">
        <label className="tempo-choice">
          <span>Output</span>
          <select value={h.mode} onChange={(e) => void setHeadphoneMode(e.target.value)} data-testid="phones-mode">
            <option value="off">Off</option>
            <option value="split">Split: left ear cue, right ear master</option>
            {h.fourOutputs && <option value="ch34">Controller / interface: outputs 3–4</option>}
            {h.canChooseDevice && <option value="device">A second sound output…</option>}
          </select>
        </label>
        {h.mode === "device" || (h.canChooseDevice && h.mode === "off" && h.devices.length > 1) ? (
          <label className="tempo-choice">
            <span>Headphones on</span>
            <select value={h.deviceId} onChange={(e) => void setHeadphoneMode("device", e.target.value)} data-testid="phones-device">
              <option value="">Choose…</option>
              {h.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Knob label="CUE MIX" value={h.cueMix} bipolar={false} onChange={setCueMix} readout={h.cueMix < 0.05 ? "cue" : h.cueMix > 0.95 ? "master" : `${Math.round((1 - h.cueMix) * 100)}% cue`} testid="cue-mix" />
        <Knob label="PHONES" value={h.volume} bipolar={false} onChange={setHeadphoneVolume} readout={`${Math.round(h.volume * 100)}%`} testid="phones-volume" />
      </div>
      {h.message && (
        <p className="fnote" role="status">
          {h.message}
        </p>
      )}
      {h.mode === "split" && <p className="muted fnote">One headphone: the left ear plays what you're cueing, the right ear plays what the crowd hears. A splitter cable sends the right side to the speakers too.</p>}
    </section>
  );
}

/** What the controller sends, live: for checking a controller (and telling us its numbers). */
function Messages() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    watchMessages(on);
    return () => watchMessages(false);
  }, [on]);
  return (
    <div className="midi-monitor">
      <button type="button" className="link-btn" onClick={() => setOn(!on)} data-testid="monitor-toggle">
        {on ? "Hide what the controller sends" : "Show what the controller sends"}
      </button>
      {on && (
        <ol className="monitor-list" data-testid="monitor">
          {controller.recent.length ? controller.recent.map((m) => <li key={m.at + m.label + m.value}>{`${m.label} → ${m.value}`}</li>) : <li className="muted">Move a knob or press a button…</li>}
        </ol>
      )}
    </div>
  );
}

/** Controller: connect, then Learn each function. */
export function ControllerPanel() {
  useStore(controller);
  const c = controller;
  if (!c.supported)
    return (
      <section className="gear" aria-label="Controller">
        <div className="gear-head">
          <h3>🎛 Controller</h3>
          <span className="muted">DJ controllers work in Chrome or Edge on a computer.</span>
        </div>
      </section>
    );
  const learned = Object.keys(c.map).length;
  return (
    <section className="gear" aria-label="Controller" data-testid="controller-panel">
      <div className="gear-head">
        <h3>🎛 Controller</h3>
        <span className="muted">
          {c.status === "on" ? (c.inputs.length ? `Connected: ${c.inputs.join(", ")}` : "Waiting for a controller: plug one in") : c.status === "denied" ? "The browser said no: allow MIDI for this site and try again" : "Any MIDI DJ controller: press Learn, move a knob, done"}
        </span>
        {c.status !== "on" && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void connectController()} disabled={c.status === "asking"} data-testid="controller-connect">
            {c.status === "asking" ? "Asking…" : "Connect a controller"}
          </button>
        )}
      </div>
      {c.preset && (
        <div className="preset" data-testid="preset">
          {presetInUse(c.preset) ? (
            <p className="fnote" data-testid="preset-on">
              ✓ {c.preset.name} layout in use. {c.preset.note}
            </p>
          ) : (
            <>
              <p className="fnote">
                {c.preset.name} found. Use its ready-made layout? {c.preset.note}
              </p>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => usePreset(c.preset.id)} data-testid="preset-use">
                Use the {c.preset.name} layout
              </button>
            </>
          )}
        </div>
      )}
      {c.status === "on" && <Messages />}
      <Fold id="controller-map" label="Learn" summary={learned ? `${learned} control${learned === 1 ? "" : "s"} learned` : "nothing learned yet"}>
        {c.learning && (
          <p className="fnote" role="status" data-testid="learning">
            Now move a knob or press a pad on the controller for “{TARGETS.find((t) => t.id === c.learning)?.label}”. Press Learn again to cancel.
          </p>
        )}
        <ul className="learn-list">
          {TARGETS.map((t) => (
            <li key={t.id} className={c.learning === t.id ? "learn-on" : ""}>
              <span>{t.label}</span>
              <span className="muted learn-key">{c.map[t.id] ? controlLabel(c.map[t.id]) : "—"}</span>
              <button type="button" className={`kill${c.learning === t.id ? " kill-on" : ""}`} onClick={() => learn(t.id)} data-testid={`learn-${t.id}`}>
                {c.learning === t.id ? "Move it…" : "Learn"}
              </button>
              {c.map[t.id] && (
                <button type="button" className="link-btn" onClick={() => forget(t.id)} aria-label={`Forget ${t.label}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {learned > 0 && (
          <button type="button" className="link-btn" onClick={forgetAll}>
            Forget them all
          </button>
        )}
      </Fold>
    </section>
  );
}
