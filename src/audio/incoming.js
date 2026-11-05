/**
 * Tracks sent to DriftMix from outside it:
 *
 *  - Share › DriftMix on a phone (Android, with DriftMix installed). The
 *    service worker (src/sw.js) catches the shared files, keeps them on the
 *    device for a moment and opens DriftMix with ?shared, and they're picked
 *    up here.
 *  - Open with › DriftMix on a computer (Chrome or Edge, with DriftMix
 *    installed): the browser hands the files over through its launch queue.
 *
 * Either way they go into the Auto DJ playlist, and DriftMix shows it.
 * Nothing leaves the device.
 */
import { addTracks, autoDj } from "./autodj.js";
import { goTo } from "./tabs.js";

/** Where the service worker keeps shared tracks until the page takes them. */
export const SHARED_CACHE = "shared-tracks";

export function startIncoming() {
  if (typeof window === "undefined") return;
  // Open with › DriftMix (computer).
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = await Promise.all(params.files.map((handle) => handle.getFile().catch(() => null)));
      receive(files.filter(Boolean));
    });
  }
  // Share › DriftMix (phone).
  const url = new URL(window.location.href);
  if (url.searchParams.has("shared")) {
    url.searchParams.delete("shared");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    void takeShared();
  }
}

async function takeShared() {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(SHARED_CACHE);
    const requests = await cache.keys();
    const files = [];
    for (const req of requests) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get("x-name") || "Shared track");
      files.push(new File([blob], name, { type: blob.type || res.headers.get("content-type") || "" }));
    }
    await caches.delete(SHARED_CACHE); // taken: nothing is left behind
    if (files.length) receive(files);
    else note("Nothing came through from the share. Try sharing the track again.");
  } catch {
    note("Couldn't pick up the shared tracks. Try sharing them again.");
  }
}

function receive(files) {
  const { added } = addTracks(files);
  const skipped = files.length - added;
  goTo("autodj");
  if (!added) {
    note(skipped ? "That doesn't look like an audio file DriftMix can play." : "Those tracks are already in the playlist.");
    return;
  }
  const what = added === 1 ? "1 track" : `${added} tracks`;
  note(`Added ${what} to the playlist${skipped ? ` (${skipped} not audio, left out)` : ""}.${autoDj.on ? "" : " Press Start to play."}`);
}

function note(message) {
  autoDj.message = message;
  autoDj.emit();
}
