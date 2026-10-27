/**
 * The transition plan (step 5): when the blend starts, where the next track
 * comes in, how much it's stretched and shifted, and when the bass swaps.
 * Pure maths, so it can be tested without sound.
 *
 * Times called "track seconds" are positions in the original file. A deck
 * that's been stretched plays its track faster or slower than real time:
 * `speed` is track seconds per real second (1 = untouched).
 */

export const BAR_CHOICES = [8, 16, 32];

/**
 * @param {object} p
 * @param {{ bpm: number, firstBeat: number, position: number, speed: number, duration: number }} p.now
 *   bpm and firstBeat as detected in the original file; position in track seconds.
 * @param {{ bpm: number, firstBeat: number, cue: number, duration: number }} p.next
 * @param {number} p.bars          blend length wanted (8, 16 or 32)
 * @param {number} [p.semitones]   key shift for the next track (−2…+2)
 * @param {number} [p.factor]      1, or 2 / 0.5 for double / half time (from the match light)
 * @param {number} [p.lead]        least real seconds before the blend starts (time to schedule)
 */
export function planTransition({ now, next, bars, semitones = 0, factor = 1, lead = 0.3 }) {
  const nowBpm = now.bpm * now.speed; // what the audience hears now
  const nowBeatTrack = 60 / now.bpm; // one beat, in the now deck's track seconds
  const realBeat = 60 / nowBpm;

  // 1. Start on the next bar (every 4 beats from the first beat) far enough ahead.
  const earliest = now.position + lead * now.speed;
  const beatsIn = (earliest - now.firstBeat) / nowBeatTrack;
  const barBeat = Math.max(0, Math.ceil(beatsIn / 4 - 1e-9) * 4);
  const startTrack = now.firstBeat + barBeat * nowBeatTrack;
  const startIn = (startTrack - now.position) / now.speed;

  // 2. Fit the blend in what's left of the playing track (shorten if needed).
  const leftReal = (now.duration - startTrack) / now.speed;
  let useBars = bars;
  while (useBars > 4 && useBars * 4 * realBeat > leftReal) useBars /= 2;
  const blendSeconds = useBars * 4 * realBeat;
  const fits = blendSeconds <= leftReal + 1e-6;

  // 3. Next track: start on its beat grid, at the beat nearest its cue point
  //    (the first beat when no cue is set).
  const nextBeatTrack = 60 / next.bpm;
  const cueBeats = Math.max(0, Math.round((next.cue - next.firstBeat) / nextBeatTrack));
  const nextStart = next.firstBeat + cueBeats * nextBeatTrack;

  // 4. Speed and pitch. The next track must play at the now tempo (or half /
  //    double it). pitchRate shifts the key by whole semitones; the stretch
  //    makes up the rest so the tempo is still exact.
  const speed = nowBpm / (next.bpm * factor);
  const pitchRate = 2 ** (semitones / 12);
  const stretchTempo = speed / pitchRate;
  const nextLeftReal = (next.duration - nextStart) / speed;

  return {
    startIn, // real seconds from now until the blend starts
    startTrack, // where the playing track is at that moment (track seconds)
    bars: useBars,
    fits,
    blendSeconds,
    swapAt: blendSeconds / 2, // bass swap, half way (always on a bar)
    swapLength: realBeat / 2, // the swap itself takes half a beat
    nextStart, // where the next track comes in (track seconds)
    speed, // next track: track seconds per real second
    pitchRate, // Web Audio playbackRate for the key shift
    stretchTempo, // WSOLA tempo for the next track's stretched copy
    nextBpm: nowBpm / factor,
    nextLongEnough: nextLeftReal >= blendSeconds,
  };
}

/**
 * Equal-power fade shapes for the blend: the outgoing track fades from its
 * current level to silence, the incoming one from silence to full, keeping
 * the overall loudness steady.
 * @returns {{ out: Float32Array, in: Float32Array }}
 */
export function blendCurves(points, startLevel = 1) {
  const fadeOut = new Float32Array(points);
  const fadeIn = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    fadeOut[i] = startLevel * Math.cos((t * Math.PI) / 2);
    fadeIn[i] = Math.sin((t * Math.PI) / 2);
  }
  fadeOut[points - 1] = 0;
  fadeIn[points - 1] = 1;
  return { out: fadeOut, in: fadeIn };
}
