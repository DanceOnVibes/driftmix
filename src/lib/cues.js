/**
 * Hot cues and loops: the maths, tested without sound.
 *
 *  - Hot cues are set on the nearest beat (when the track has a tempo), so
 *    jumping to one keeps the beat: the jump lands as far into the cue's
 *    beat as the playhead was into its own, like quantize on a CDJ.
 *  - A beat loop starts on the beat the playhead is in (half beat for a ½
 *    loop) and is a whole number of beats long, so it loops in time.
 */

export const HOT_CUES = 4;
export const LOOP_BEATS = [0.5, 1, 2, 4, 8, 16];

/** The nearest beat to a moment (or the moment itself without a tempo). */
export function quantize(seconds, tempo) {
  if (!tempo) return Math.max(0, seconds);
  const beat = 60 / tempo.bpm;
  let at = tempo.firstBeat + Math.round((seconds - tempo.firstBeat) / beat) * beat;
  while (at < 0) at += beat;
  return at;
}

/**
 * Where a hot cue jump lands: on the cue, plus how far the playhead is into
 * its beat right now (so the beat carries on without a stumble).
 */
export function jumpTarget(position, cue, tempo, playing) {
  if (!tempo || !playing) return cue;
  const beat = 60 / tempo.bpm;
  const phase = (((position - tempo.firstBeat) % beat) + beat) % beat;
  const cuePhase = (((cue - tempo.firstBeat) % beat) + beat) % beat;
  return cue - cuePhase + phase;
}

/**
 * A beat loop around the playhead.
 * @returns {{ start: number, end: number, beats: number }}  track seconds
 */
export function loopAt(position, tempo, beats) {
  const beat = 60 / tempo.bpm;
  const step = beats < 1 ? beats * beat : beat;
  let start = tempo.firstBeat + Math.floor((position - tempo.firstBeat) / step + 1e-9) * step;
  if (start < 0) start += step;
  return { start, end: start + beats * beat, beats };
}

/** The same loop made longer or shorter: it keeps its start (like a CDJ). */
export function resizeLoop(loop, tempo, beats) {
  return { start: loop.start, end: loop.start + (beats * 60) / tempo.bpm, beats };
}

/** Where the playhead really is, once a loop has gone round. */
export function wrapPosition(linear, loop) {
  if (!loop || linear < loop.end) return linear;
  const len = loop.end - loop.start;
  return loop.start + ((linear - loop.start) % len);
}

/** One name per track for keeping its hot cues on this device. */
export function cueKey(name, duration) {
  return `${name}|${Math.round(duration * 10) / 10}`;
}
