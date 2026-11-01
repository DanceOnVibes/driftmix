/**
 * DJ controllers (MIDI), the "Learn" way: press Learn next to a function,
 * move a knob or press a pad on the controller, done. Works with any brand;
 * the assignments are remembered on this device.
 *
 * Chrome and Edge can talk to controllers (Web MIDI); the browser asks for
 * permission the first time.
 */
import { TARGETS, parseMidi, controlKey, valueFor } from "../lib/midi.js";
import { decks, setCrossfader, crossfader } from "./engine.js";
import { setCueMix, setHeadphoneVolume } from "./headphones.js";

const SAVED = "driftmix.controller.v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(SAVED) || "{}") || {};
  } catch {
    return {};
  }
}

export const controller = {
  supported: typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function",
  status: "off", // off | asking | on | denied
  inputs: [], // names of what's plugged in
  map: load(), // { targetId: "cc:0:7" }
  learning: null, // the target waiting for a control
  last: "", // the last control moved, shown while learning
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

function save() {
  try {
    localStorage.setItem(SAVED, JSON.stringify(controller.map));
  } catch {
    /* not kept: fine */
  }
}

let access = null;

function listen() {
  controller.inputs = [];
  for (const input of access.inputs.values()) {
    input.onmidimessage = (e) => handleMidi(e.data);
    controller.inputs.push(input.name || "Controller");
  }
  controller.emit();
}

/** Ask the browser for the controllers (it shows a permission prompt the first time). */
export async function connectController() {
  if (!controller.supported) return;
  controller.status = "asking";
  controller.emit();
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    controller.status = "on";
    access.onstatechange = listen;
    listen();
  } catch {
    controller.status = "denied";
    controller.emit();
  }
}

/** Wait for the next control moved, and give it this function. Press again to cancel. */
export function learn(targetId) {
  controller.learning = controller.learning === targetId ? null : targetId;
  controller.emit();
}

export function forget(targetId) {
  const { [targetId]: _gone, ...rest } = controller.map;
  controller.map = rest;
  save();
  controller.emit();
}

export function forgetAll() {
  controller.map = {};
  controller.learning = null;
  save();
  controller.emit();
}

/** One message from a controller (also used by the tests). */
export function handleMidi(bytes) {
  const msg = parseMidi(bytes);
  if (!msg) return;
  const key = controlKey(msg);
  if (controller.learning) {
    // Learn on a knob move, or on a pad going down (not on its release).
    if (msg.type === "note" && !msg.down) return;
    const map = Object.fromEntries(Object.entries(controller.map).filter(([, k]) => k !== key)); // one control, one job
    map[controller.learning] = key;
    controller.map = map;
    controller.learning = null;
    controller.last = key;
    save();
    controller.emit();
    return;
  }
  for (const [id, k] of Object.entries(controller.map)) {
    if (k !== key) continue;
    const target = TARGETS.find((t) => t.id === id);
    if (!target) continue;
    const value = valueFor(target, msg);
    if (value === null) continue;
    act(id, value);
  }
}

function act(id, value) {
  if (id === "crossfader") return crossfader.locked ? undefined : setCrossfader(value);
  if (id === "mix") return document.querySelector('[data-testid="mix"]')?.click();
  if (id === "cue-mix") return setCueMix(value);
  if (id === "phones-volume") return setHeadphoneVolume(value);
  const m = /^(.+)-([ab])$/.exec(id);
  if (!m) return;
  const deck = decks[m[2]];
  const what = m[1];
  if (what === "play") return deck.toggle();
  if (what === "cue") return deck.pressCue();
  if (what === "volume") return deck.setVolume(value);
  if (what === "low" || what === "mid" || what === "high") return deck.setEq(what, value);
  if (what === "filter") return deck.setFilter(value);
  if (what === "echo" || what === "verb") return deck.setFx(what, value);
  if (what === "headphones") return deck.toggleHeadphones();
  const hc = /^hotcue(\d)$/.exec(what);
  if (hc) return deck.pressHotCue(Number(hc[1]) - 1);
}
