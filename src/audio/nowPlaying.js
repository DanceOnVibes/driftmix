/**
 * What's playing, for the phone's lock screen, the notification shade,
 * Bluetooth and headphone buttons and the keyboard's media keys
 * (the Media Session API).
 *
 *  - The title is the track on the playing deck (with DriftMix as the artist).
 *  - Play / Pause there act like the deck's own Play button: a pause stops a
 *    transition or Auto DJ the same way, and Play carries on from there.
 *  - Phones only show these controls for a media element, and DriftMix plays
 *    through Web Audio, so a silent sound loops quietly alongside while a
 *    deck plays. It's silence: it adds nothing to the mix or a recorded set.
 */
import { decks } from "./engine.js";
import { nowAndNext } from "./transition.js";
import { encodeWav } from "../lib/files/wav.js";

let keepAlive = null;
let lastTitle = null;
let resume = []; // the decks a lock-screen pause stopped

function silentLoop() {
  if (keepAlive) return keepAlive;
  const sr = 8000;
  const bytes = encodeWav([new Float32Array(sr)], sr, 16); // one second of silence
  keepAlive = new Audio(URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })));
  keepAlive.loop = true;
  keepAlive.setAttribute("aria-hidden", "true");
  return keepAlive;
}

export function startNowPlaying() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
  const session = navigator.mediaSession;
  const both = [decks.a, decks.b];

  const update = () => {
    const playing = both.filter((d) => d.playing);
    const [now] = nowAndNext();
    const title = now.name || "";
    if (title !== lastTitle) {
      lastTitle = title;
      session.metadata = title
        ? new MediaMetadata({
            title,
            artist: "DriftMix",
            artwork: [
              { src: new URL("./icon-192.png", location.href).href, sizes: "192x192", type: "image/png" },
              { src: new URL("./icon-512.png", location.href).href, sizes: "512x512", type: "image/png" },
            ],
          })
        : null;
    }
    session.playbackState = playing.length ? "playing" : now.buffer ? "paused" : "none";
    if (playing.length) void silentLoop().play().catch(() => {});
    else keepAlive?.pause();
  };
  for (const d of both) d.subscribe(update);

  const handle = (action, fn) => {
    try {
      session.setActionHandler(action, fn);
    } catch {
      /* this browser doesn't offer that button */
    }
  };
  const pause = () => {
    resume = both.filter((d) => d.playing);
    for (const d of resume) d.toggle(); // the same as pressing the deck's Pause
  };
  handle("pause", pause);
  handle("stop", pause);
  handle("play", () => {
    const toPlay = resume.filter((d) => d.buffer && !d.playing);
    resume = [];
    if (toPlay.length) for (const d of toPlay) d.toggle();
    else {
      const [now] = nowAndNext();
      if (now.buffer && !now.playing) now.toggle();
    }
  });
}
