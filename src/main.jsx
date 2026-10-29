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
  void Promise.all([
    import("./audio/engine.js"),
    import("./audio/transition.js"),
    import("./audio/booth.js"),
    import("./audio/autodj.js"),
    import("./audio/setrec.js"),
  ]).then(([engine, transition, booth, autodj, setrec]) => {
    window.driftmix = {
      decks: engine.decks,
      crossfader: engine.crossfader,
      audioContext: engine.audioContext,
      mix: transition.mix,
      booth: booth.booth,
      autoDj: autodj.autoDj,
      setRec: setrec.setRec,
    };
  });
}
