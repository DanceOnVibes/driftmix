/**
 * Demo: one tap loads a few of The Drift3r's own tracks into Auto DJ and
 * starts the set, so someone new hears a mix within seconds.
 *
 * The tracks live in public/demo/ with a demo.json listing them:
 *   { "tracks": [{ "file": "vortex.mp3", "title": "Vortex of Your Music" }, …] }
 * With no demo.json, there's no demo button.
 */
import { addTracks, autoDj, startAutoDj } from "./autodj.js";
import { audioContext } from "./engine.js";

export const demo = {
  tracks: [], // { file, title } from demo.json
  status: "none", // none | ready | loading | failed
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

/** Look for the demo list (quietly: no list, no button). */
export async function findDemo() {
  try {
    const res = await fetch("./demo/demo.json", { cache: "no-cache" });
    if (!res.ok) return;
    const list = await res.json();
    demo.tracks = (list.tracks || []).filter((t) => t && typeof t.file === "string" && /^[\w .()-]+\.(mp3|m4a|wav)$/i.test(t.file));
    demo.status = demo.tracks.length >= 2 ? "ready" : "none";
  } catch {
    demo.status = "none";
  }
  demo.emit();
}

/** Load the demo tracks into Auto DJ and start the set. */
export async function playDemo() {
  if (demo.status !== "ready" || autoDj.on) return;
  void audioContext(); // wake the sound up while the tap still counts
  demo.status = "loading";
  demo.emit();
  try {
    const files = await Promise.all(
      demo.tracks.map(async (t) => {
        const res = await fetch(`./demo/${encodeURIComponent(t.file)}`);
        if (!res.ok) throw new Error("missing");
        const blob = await res.blob();
        // Named by its title, so the decks show "Dracula's Land", not "draculas-land".
        const ext = (t.file.match(/\.[^.]+$/) || [".mp3"])[0];
        const name = t.title || t.file.replace(/\.[^.]+$/, "");
        return { file: new File([blob], `${name}${ext}`, { type: blob.type || "audio/mpeg" }), name };
      }),
    );
    addTracks(files);
    // Wait for the tempo and key of each, then go.
    const started = Date.now();
    while (autoDj.tracks.some((t) => t.status === "reading") && Date.now() - started < 60000) await new Promise((r) => setTimeout(r, 200));
    demo.status = "ready";
    demo.emit();
    await startAutoDj();
  } catch {
    demo.status = "failed";
    demo.emit();
  }
}
