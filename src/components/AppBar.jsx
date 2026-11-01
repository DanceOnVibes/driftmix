import { useEffect, useReducer, useRef, useState } from "react";
import { app, applyUpdate, install, checkForUpdate } from "../audio/app.js";

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

export function InstallButton({ inMenu = false }) {
  useApp();
  const [hint, setHint] = useState(false);
  const cls = inMenu ? "menu-item" : "link-btn install-btn";
  if (app.installed) return null;
  if (app.canInstall)
    return (
      <button type="button" className={cls} role={inMenu ? "menuitem" : undefined} onClick={() => void install()} data-testid="install">
        Install app
      </button>
    );
  if (app.ios)
    return (
      <span className={inMenu ? "install-ios install-ios-menu" : "install-ios"}>
        <button type="button" className={cls} onClick={() => setHint((h) => !h)} aria-expanded={hint} data-testid="install-ios">
          Install app
        </button>
        {hint && <span className="install-hint">Tap Share, then “Add to Home Screen”.</span>}
      </span>
    );
  return null;
}

const SOURCE = "https://github.com/DanceOnVibes/driftmix";

/**
 * The ⚙ menu: the app things that don't need to be on screen all the time.
 * Install, check for a new version, the version number, source code and
 * credits. Closes on a tap outside or Escape.
 */
export function AppMenu() {
  useApp();
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const escape = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const runCheck = async () => {
    setCheck("Checking…");
    const result = await checkForUpdate();
    setCheck(result === "update" ? "A new version is ready: press Update at the top." : result === "latest" ? "You have the latest version." : "Can't check right now (offline?).");
  };
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="menu-btn"
        aria-label="App menu"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        data-testid="app-menu"
      >
        ⚙{app.update && <span className="menu-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="menu-panel" role="menu" data-testid="app-menu-panel">
          {app.update && (
            <button type="button" role="menuitem" className="menu-item menu-item-gold" onClick={applyUpdate}>
              Update to the new version
            </button>
          )}
          <InstallButton inMenu />
          <button type="button" role="menuitem" className="menu-item" onClick={() => void runCheck()} data-testid="check-update">
            Check for updates
          </button>
          {check && (
            <p className="menu-note" role="status" data-testid="check-result">
              {check}
            </p>
          )}
          <a role="menuitem" className="menu-item" href={SOURCE} target="_blank" rel="noopener">
            Source code (AGPL-3.0)
          </a>
          <p className="menu-note">
            Version {app.version}
            <br />
            MP3 encoding by <a href="https://lame.sourceforge.io">LAME</a> (via lamejs, LGPL)
            <br />
            Time-stretch by <a href="https://signalsmith-audio.co.uk/code/stretch/">Signalsmith Stretch</a> (<a href="/licenses/signalsmith-stretch.txt">MIT</a>)
          </p>
        </div>
      )}
    </div>
  );
}

function useApp() {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => app.subscribe(refresh), []);
}
