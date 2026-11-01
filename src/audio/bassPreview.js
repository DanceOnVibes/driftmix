/**
 * Before / after: hear a track's drop with and without the bass, flipping
 * between the two while it plays (both run together, in sync; a flip just
 * swaps which one you hear, so it's a fair comparison).
 *
 * The "with bass" side uses the browser's own filters set exactly like the
 * conversion (rumble cut, warm shelf, mud dip), so what you hear is what the
 * file gets. It plays straight to the speakers, not through the decks, so a
 * set being recorded never picks it up.
 */
import { audioContext } from "./engine.js";
import { RUMBLE_HZ, SHELF_HZ, MUD_HZ, mudCutDb } from "../lib/files/bass.js";

const SECONDS = 20;

export const preview = {
  id: null, // the Files item playing
  side: "after", // "before" | "after"
  loading: false,
  db: 0,
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

let nodes = null;
let cache = { file: null, buffer: null };
let ticket = 0;

/** Play the drop of a track: `db` of bass on the "after" side. */
export async function playPreview(it, db) {
  const mine = ++ticket;
  stopPreview(false);
  const ctx = audioContext();
  preview.id = it.id;
  preview.db = db;
  preview.side = db > 0 ? "after" : "before";
  preview.loading = true;
  preview.emit();
  try {
    if (cache.file !== it.file) cache = { file: it.file, buffer: await ctx.decodeAudioData(await it.file.arrayBuffer()) };
  } catch {
    if (mine === ticket) stopPreview();
    return;
  }
  if (mine !== ticket) return;
  const buffer = cache.buffer;
  const start = Math.min(it.dropAt || 0, Math.max(0, buffer.duration - SECONDS));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = RUMBLE_HZ;
  const shelf = ctx.createBiquadFilter();
  shelf.type = "lowshelf";
  shelf.frequency.value = SHELF_HZ;
  shelf.gain.value = db;
  const mud = ctx.createBiquadFilter();
  mud.type = "peaking";
  mud.frequency.value = MUD_HZ;
  mud.Q.value = 1;
  mud.gain.value = mudCutDb(db);
  // Like the file's limiter: catches the odd peak above −1 dB.
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -1;
  lim.knee.value = 0;
  lim.ratio.value = 20;
  lim.attack.value = 0.003;
  lim.release.value = 0.08;
  source.connect(dry).connect(ctx.destination);
  source.connect(hp).connect(shelf).connect(mud).connect(lim).connect(wet).connect(ctx.destination);
  dry.gain.value = preview.side === "before" ? 1 : 0;
  wet.gain.value = preview.side === "after" ? 1 : 0;
  source.onended = () => {
    if (nodes?.source === source) stopPreview();
  };
  source.start(ctx.currentTime + 0.05, start, SECONDS);
  nodes = { source, dry, wet };
  preview.loading = false;
  preview.emit();
}

/** Flip between the original and the bass version (a 30 ms crossfade, no click). */
export function setSide(side) {
  preview.side = side;
  if (nodes) {
    const t = audioContext().currentTime;
    for (const [node, on] of [
      [nodes.dry, side === "before"],
      [nodes.wet, side === "after"],
    ]) {
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(node.gain.value, t);
      node.gain.linearRampToValueAtTime(on ? 1 : 0, t + 0.03);
    }
  }
  preview.emit();
}

export function stopPreview(emit = true) {
  if (nodes) {
    try {
      nodes.source.onended = null;
      nodes.source.stop();
    } catch {
      /* already stopped */
    }
    nodes = null;
  }
  if (emit) {
    ticket++;
    preview.id = null;
    preview.loading = false;
    preview.emit();
  }
}
