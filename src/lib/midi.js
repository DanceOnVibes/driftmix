/**
 * MIDI controllers, the "Learn" way: press Learn next to something in
 * DriftMix, move a knob or press a button on the controller, and from then
 * on that control does that thing. Works with any brand.
 *
 * Knobs and faders send "control change" (CC) messages, 0–127; pads and
 * buttons send "note on" (pressed) and "note off" (let go).
 */

/** What DriftMix can be controlled from a controller. `kind`: knob (−1…+1), fx (0…1), fader (0…1), xfader (−1…+1), button. */
export const TARGETS = [];
for (const d of ["a", "b"]) {
  const D = d.toUpperCase();
  TARGETS.push(
    { id: `play-${d}`, label: `Deck ${D}: play / pause`, kind: "button" },
    { id: `cue-${d}`, label: `Deck ${D}: cue`, kind: "button" },
    { id: `volume-${d}`, label: `Deck ${D}: volume`, kind: "fader" },
    { id: `low-${d}`, label: `Deck ${D}: LOW`, kind: "knob" },
    { id: `mid-${d}`, label: `Deck ${D}: MID`, kind: "knob" },
    { id: `high-${d}`, label: `Deck ${D}: HIGH`, kind: "knob" },
    { id: `filter-${d}`, label: `Deck ${D}: FILTER`, kind: "knob" },
    { id: `echo-${d}`, label: `Deck ${D}: ECHO`, kind: "fx" },
    { id: `verb-${d}`, label: `Deck ${D}: VERB`, kind: "fx" },
    { id: `headphones-${d}`, label: `Deck ${D}: headphones`, kind: "button" },
    ...[1, 2, 3, 4].map((n) => ({ id: `hotcue${n}-${d}`, label: `Deck ${D}: hot cue ${n}`, kind: "button" })),
  );
}
TARGETS.push(
  { id: "crossfader", label: "Crossfader", kind: "xfader" },
  { id: "mix", label: "Mix (one-press transition)", kind: "button" },
  { id: "cue-mix", label: "Headphones: cue mix", kind: "fx" },
  { id: "phones-volume", label: "Headphones: volume", kind: "fx" },
);

/**
 * Read a MIDI message.
 * @param {ArrayLike<number>} bytes
 * @returns {{ type: "cc"|"note", channel: number, number: number, value: number, down?: boolean } | null}
 */
export function parseMidi(bytes) {
  if (!bytes || bytes.length < 3) return null;
  const status = bytes[0] & 0xf0;
  const channel = bytes[0] & 0x0f;
  const number = bytes[1] & 0x7f;
  const value = bytes[2] & 0x7f;
  if (status === 0xb0) return { type: "cc", channel, number, value };
  if (status === 0x90) return { type: "note", channel, number, value, down: value > 0 };
  if (status === 0x80) return { type: "note", channel, number, value: 0, down: false };
  return null;
}

/** One name per physical control: "cc:0:7", "note:1:36". */
export function controlKey(msg) {
  return `${msg.type}:${msg.channel}:${msg.number}`;
}

/**
 * What a message means for a target: a value for knobs and faders (with the
 * centre of a knob landing exactly on 0), or "press" for buttons (on the way
 * down only, so a pad doesn't fire twice).
 */
export function valueFor(target, msg) {
  if (target.kind === "button") {
    if (msg.type === "note") return msg.down ? "press" : null;
    return msg.value >= 64 ? "press" : null; // buttons that send CC 127 / 0
  }
  const f = msg.value / 127;
  if (target.kind === "knob" || target.kind === "xfader") {
    if (msg.value === 63 || msg.value === 64) return 0; // the controller's centre detent
    return Math.round((f * 2 - 1) * 100) / 100;
  }
  return Math.round(f * 100) / 100;
}

/** "CC 7 · ch 1", "Note 36 · ch 2": how an assignment reads. */
export function controlLabel(key) {
  const [type, channel, number] = String(key).split(":");
  return `${type === "cc" ? "CC" : "Note"} ${number} · ch ${Number(channel) + 1}`;
}
