/**
 * Set types for Auto DJ: one pick sets the order, tempo, blend length,
 * build-ups and roughly how long the set runs, for the occasion.
 * Every setting can still be changed after.
 */
export const SET_TYPES = {
  custom: { label: "My own settings" },
  "warm-up": {
    label: "Warm-up · 30 min",
    about: "slow to fast, each track at its own tempo, long 32-bar blends",
    settings: { orderBy: "tempo-up", tempoChoice: "journey", bars: 32, buildUps: "off", stopAfter: 30 },
  },
  gym: {
    label: "Gym · 45 min",
    about: "climbing tempo, quick 16-bar blends, a build-up every third mix",
    settings: { orderBy: "tempo-up", tempoChoice: "journey", bars: 16, buildUps: "third", stopAfter: 45 },
  },
  peak: {
    label: "Peak time · 60 min",
    about: "one locked tempo, flowing keys, 16-bar blends, a build-up every third mix",
    settings: { orderBy: "keys", tempoChoice: "first", bars: 16, buildUps: "third", stopAfter: 60 },
  },
  chill: {
    label: "Chill or dinner · 60 min",
    about: "flowing keys, each track at its own tempo, long 32-bar blends, no build-ups",
    settings: { orderBy: "keys", tempoChoice: "journey", bars: 32, buildUps: "off", stopAfter: 60 },
  },
};

/** How long a set runs: the whole playlist, or about this many minutes. */
export const STOP_AFTER = [0, 30, 45, 60, 90, 120];

/**
 * Is the track now playing the last one of a set with a time limit?
 * It is when, by the time it ends, the set will be within a minute of the
 * limit or past it (sets end on a whole track, never cut short).
 * @param {number} limitMinutes 0 = no limit
 * @param {number} elapsed      seconds since the set started
 * @param {number} remaining    seconds left of the track now playing
 */
export function lastTrack(limitMinutes, elapsed, remaining) {
  if (!(limitMinutes > 0)) return false;
  return elapsed + remaining >= limitMinutes * 60 - 60;
}
