/**
 * Closing the tab mid-set: the browser asks "Leave site?" first, but only
 * when something would really be lost — music playing, a set or a vocal
 * being recorded, or Vocal Booth takes that haven't been saved. Everything
 * else (playlists, decks, pads) is kept on this device anyway (keep.js).
 */
import { decks } from "./engine.js";
import { setRec } from "./setrec.js";
import { booth } from "./booth.js";

export function wouldLose() {
  if (decks.a.playing || decks.b.playing) return "music playing";
  if (setRec.state === "recording" || setRec.state === "finishing") return "a set being recorded";
  if (["counting", "recording", "saving"].includes(booth.mode)) return "a vocal being recorded";
  if (booth.takes.length && !booth.outputs.length) return "unsaved Vocal Booth takes";
  return null;
}

export function startLeavingGuard() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", (event) => {
    if (!wouldLose()) return;
    event.preventDefault();
    event.returnValue = ""; // older browsers need this to ask
  });
}
