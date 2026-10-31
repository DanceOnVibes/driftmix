import { useState } from "react";

/**
 * Settings that stay folded away until you want them: a button with a short
 * summary of what's set ("MP3 320 kbps · stereo"), and the settings
 * underneath when it's open. Each fold remembers open or closed on this
 * device. Adding ?open to the address opens every fold (handy for support
 * and for the browser tests).
 */
const SAVED = "driftmix.folds.v1";

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(SAVED) || "{}") || {};
  } catch {
    return {};
  }
}

const openAll = (() => {
  try {
    return new URLSearchParams(location.search).has("open");
  } catch {
    return false;
  }
})();

export function Fold({ id, label = "Settings", summary, children }) {
  const [open, setOpen] = useState(() => openAll || Boolean(remembered()[id]));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(SAVED, JSON.stringify({ ...remembered(), [id]: next }));
    } catch {
      /* not remembered: fine */
    }
  };
  return (
    <div className={`fold${open ? " fold-open" : ""}`}>
      <button type="button" className="fold-btn" aria-expanded={open} aria-controls={`${id}-body`} onClick={toggle} data-testid={`${id}-fold`}>
        <span className="fold-label">{label}</span>
        {summary && <span className="fold-sum">{summary}</span>}
        <span className="fold-arrow" aria-hidden="true">
          ▸
        </span>
      </button>
      <div id={`${id}-body`} className="fold-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
