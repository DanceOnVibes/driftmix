/**
 * The DJ knobs on each deck, as numbers the audio engine can use.
 * Every knob runs from −1 to +1 (or 0 to 1 for the effects), with the
 * centre (0) meaning "untouched", like a mixer's centre detent.
 *
 *  - LOW / MID / HIGH: left cuts (all the way = a kill), right boosts up
 *    to +6 dB. The cut side is curved, so the first half of the turn is a
 *    gentle dip and the last bit drops to nothing, as on a club mixer.
 *  - FILTER: left = low-pass (the track gets darker, down to 200 Hz),
 *    right = high-pass (thinner, up to 6 kHz), centre = off.
 *  - ECHO / VERB: how much goes to the echo (timed to the track's beat)
 *    and the reverb.
 */

export const KILL_DB = -40;
export const BOOST_DB = 6;
export const EQ_BANDS = {
  low: { type: "lowshelf", hz: 120 },
  mid: { type: "peaking", hz: 1000, q: 0.7 },
  high: { type: "highshelf", hz: 4500 },
};

/** Knob (−1 … +1) → EQ gain in dB. */
export function eqGainDb(value) {
  const v = Math.max(-1, Math.min(1, Number(value) || 0));
  if (v >= 0) return BOOST_DB * v;
  if (v <= -0.97) return KILL_DB;
  return KILL_DB * v * v;
}

/** Knob (−1 … +1) → the two filter corners in Hz: { lowpass, highpass }. */
export function filterHz(value) {
  const v = Math.max(-1, Math.min(1, Number(value) || 0));
  const open = { lowpass: 22000, highpass: 10 };
  if (Math.abs(v) < 0.03) return open;
  if (v < 0) return { lowpass: 22000 * (200 / 22000) ** ((-v - 0.03) / 0.97), highpass: 10 };
  return { lowpass: 22000, highpass: 20 * (6000 / 20) ** ((v - 0.03) / 0.97) };
}

/** Echo time for a tempo: a dotted eighth (¾ of a beat), the classic DJ echo. 0.375 s without a tempo. */
export function echoSeconds(bpm) {
  return bpm > 0 ? (60 / bpm) * 0.75 : 0.375;
}

/** How a knob reads out: "−∞", "−6 dB", "+3 dB", "LP 1.2k", "HP 300", "40%". */
export function knobLabel(kind, value) {
  if (kind === "eq") {
    const db = eqGainDb(value);
    if (db <= KILL_DB) return "−∞";
    if (Math.abs(db) < 0.25) return "0 dB";
    return `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(Math.abs(db) < 10 ? 1 : 0)} dB`;
  }
  if (kind === "filter") {
    const f = filterHz(value);
    const fmt = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : String(Math.round(hz)));
    if (f.lowpass < 22000) return `LP ${fmt(f.lowpass)}`;
    if (f.highpass > 10) return `HP ${fmt(f.highpass)}`;
    return "off";
  }
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

/**
 * A reverb "room": a few seconds of fading noise, slightly different per
 * ear, darker as it fades (what a hall sounds like to a ConvolverNode).
 * Deterministic, so every reverb sounds the same.
 */
export function reverbImpulse(sampleRate, seconds = 2.6, decay = 3.2) {
  const n = Math.round(seconds * sampleRate);
  const out = [new Float32Array(n), new Float32Array(n)];
  let s = 12345;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
  for (const ch of out) {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const k = 0.15 + 0.8 * (1 - t); // brighter early, darker late
      lp += k * (rnd() - lp);
      ch[i] = lp * (1 - t) ** decay;
    }
  }
  return out;
}
