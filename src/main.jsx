import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Add ?debug to the address to look inside from the browser console
// (used by the automated tests: deck positions, tempos, fader levels).
if (new URLSearchParams(window.location.search).has("debug")) {
  void Promise.all([import("./audio/engine.js"), import("./audio/transition.js")]).then(([engine, transition]) => {
    window.driftmix = { decks: engine.decks, crossfader: engine.crossfader, audioContext: engine.audioContext, mix: transition.mix };
  });
}
