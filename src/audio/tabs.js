/**
 * Which section is on screen on a phone (Decks, Auto DJ, Samples, Booth,
 * Files). On a laptop every section shows and this only matters for links.
 * Everything keeps running in the sections you can't see: a set plays on
 * while you look at Files.
 */
export const TABS = [
  { id: "decks", label: "Decks" },
  { id: "autodj", label: "Auto DJ" },
  { id: "samples", label: "Samples" },
  { id: "booth", label: "Booth" },
  { id: "files", label: "Files" },
];
const SAVED = "driftmix.tab";
const known = (id) => TABS.some((t) => t.id === id);

function first() {
  try {
    const hash = location.hash.slice(1);
    if (known(hash)) return hash;
    const saved = localStorage.getItem(SAVED);
    if (known(saved)) return saved;
  } catch {
    /* no storage: start on the decks */
  }
  return "decks";
}

export const tabs = {
  current: typeof window === "undefined" ? "decks" : first(),
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

/** Show a section: on a phone it becomes the one on screen; on a laptop the page scrolls to it. */
export function goTo(id, { scroll = true } = {}) {
  if (!known(id)) return;
  const changed = tabs.current !== id;
  tabs.current = id;
  try {
    localStorage.setItem(SAVED, id);
  } catch {
    /* not remembered: fine */
  }
  tabs.emit();
  // Waveforms measure themselves when the window resizes: a section that was
  // hidden gets its real size now.
  requestAnimationFrame(() => {
    if (changed) window.dispatchEvent(new Event("resize"));
    if (!scroll) return;
    if (window.matchMedia("(max-width: 700px)").matches) window.scrollTo({ top: 0 });
    else if (id !== "decks") document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
