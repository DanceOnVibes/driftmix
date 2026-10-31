import { useEffect, useReducer, useState } from "react";
import { app, applyUpdate, install } from "../audio/app.js";

/** "New version ready · Update", and the Install button where it applies. */
export function UpdateStrip() {
  useApp();
  if (!app.update) return null;
  return (
    <p className="update-strip" role="status" data-testid="update-strip">
      <span>A new version of DriftMix is ready.</span>
      <button type="button" className="btn btn-gold btn-small" onClick={applyUpdate} data-testid="update-btn">
        Update
      </button>
    </p>
  );
}

export function InstallButton() {
  useApp();
  const [hint, setHint] = useState(false);
  if (app.installed) return null;
  if (app.canInstall)
    return (
      <button type="button" className="link-btn install-btn" onClick={() => void install()} data-testid="install">
        Install app
      </button>
    );
  if (app.ios)
    return (
      <span className="install-ios">
        <button type="button" className="link-btn install-btn" onClick={() => setHint((h) => !h)} aria-expanded={hint} data-testid="install-ios">
          Install app
        </button>
        {hint && <span className="install-hint">Tap Share, then “Add to Home Screen”.</span>}
      </span>
    );
  return null;
}

function useApp() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => app.subscribe(refresh), []);
}
