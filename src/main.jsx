import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import { startKeeping } from "./audio/keep.js";
import { startApp, app } from "./audio/app.js";
import { findDemo } from "./audio/demo.js";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Bring back the Files list and Auto DJ playlist kept on this device.
void startKeeping();
// Installable app, works offline, says when a new version is ready.
startApp();
// The version on the page itself (support and tests read it; also in the ⚙ menu).
document.documentElement.dataset.version = app.version;
// A demo set, if this copy of DriftMix has one.
void findDemo();

// Add ?debug to the address to look inside from the browser console
// (used by the automated tests: deck positions, tempos, fader levels).
if (new URLSearchParams(window.location.search).has("debug")) {
  void Promise.all([
    import("./audio/engine.js"),
    import("./audio/transition.js"),
    import("./audio/booth.js"),
    import("./audio/autodj.js"),
    import("./audio/setrec.js"),
    import("./audio/keep.js"),
    import("./audio/files.js"),
    import("./audio/analysis.js"),
    import("./audio/sampler.js"),
    import("./audio/headphones.js"),
    import("./audio/controller.js"),
  ]).then(([engine, transition, booth, autodj, setrec, keep, filesMod, analysis, samplerMod, phones, ctl]) => {
    window.driftmix = {
      decks: engine.decks,
      crossfader: engine.crossfader,
      audioContext: engine.audioContext,
      mix: transition.mix,
      taps: transition.taps,
      booth: booth.booth,
      autoDj: autodj.autoDj,
      setRec: setrec.setRec,
      keep,
      files: filesMod.files,
      analyzeBuffer: analysis.analyzeBuffer,
      master: engine.masterNode,
      masterOutput: engine.masterOutput,
      sampler: samplerMod.sampler,
      headphones: phones,
      controller: ctl,
    };
  });
}
