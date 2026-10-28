/**
 * Measuring the delay of a phone or laptop (its "round trip").
 *
 * When you sing along to the beat, the beat leaves the speakers or
 * headphones a little late, and your voice reaches the recorder a little
 * late too. Added up that's often 20–150 ms (more on some phones), enough to
 * make a vocal sound "behind" the beat. Recording apps hide it by measuring it.
 *
 * How we measure: play a few short clicks through the speakers at known
 * moments, record them with the microphone, and find where each one lands.
 * The delay is the median gap; if the clicks disagree with each other, or
 * can't be heard over the room, we say so instead of guessing.
 */

/** A short, bright blip with a sharp start (easy to pin down in time). */
export function blip(sampleRate, { hz = 2000, ms = 6, level = 0.8 } = {}) {
  const n = Math.round((ms / 1000) * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = level * Math.sin((2 * Math.PI * hz * i) / sampleRate) * (1 - i / n) ** 2;
  return out;
}

/**
 * The test signal: `count` blips, `gap` seconds apart, after `lead` seconds.
 * @returns {{ samples: Float32Array, times: number[] }}  times: seconds from the start of the signal
 */
export function clickTrain(sampleRate, { count = 8, gap = 0.7, lead = 0.3 } = {}) {
  const one = blip(sampleRate);
  const samples = new Float32Array(Math.round((lead + count * gap + 0.2) * sampleRate));
  const times = [];
  for (let k = 0; k < count; k++) {
    const t = lead + k * gap;
    samples.set(one, Math.round(t * sampleRate));
    times.push(t);
  }
  return { samples, times };
}

/**
 * Find the delay between when clicks were played and when they were heard.
 * @param {Float32Array} recorded  the microphone, mono
 * @param {number} sampleRate
 * @param {number[]} clickTimes  when each click was played, in seconds on the
 *   same clock as `recordStart`
 * @param {number} recordStart  when the first recorded sample was taken
 * @param {{ maxDelay?: number }} [o]  longest delay to look for (seconds)
 * @returns {{ seconds: number|null, found: number, spreadMs: number, sure: boolean }}
 */
export function findClickDelay(recorded, sampleRate, clickTimes, recordStart, { maxDelay = 0.6 } = {}) {
  // Look at changes, not levels: that ignores hum and slow rumble.
  const n = recorded.length;
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = Math.abs(recorded[i] - recorded[i - 1]);

  // How busy the room is: the median change across the whole recording.
  const sorted = Float32Array.from(d).sort();
  const floor = sorted[Math.floor(sorted.length / 2)] || 1e-9;

  const delays = [];
  for (const t of clickTimes) {
    const a = Math.max(1, Math.round((t - recordStart) * sampleRate));
    const b = Math.min(n, a + Math.round(maxDelay * sampleRate));
    if (b - a < sampleRate * 0.01) continue;
    let peak = 0;
    for (let i = a; i < b; i++) if (d[i] > peak) peak = d[i];
    // A click must stand well clear of the room (about 20 dB).
    if (peak < floor * 10) continue;
    // Its start: the first moment it rises past a third of its peak.
    let at = -1;
    for (let i = a; i < b; i++) {
      if (d[i] >= peak / 3) {
        at = i;
        break;
      }
    }
    if (at < 0) continue;
    // A click comes out of quiet. If the sound was already that busy just
    // before (someone singing, music playing), this isn't our click.
    const before = Math.max(0, at - Math.round(0.02 * sampleRate));
    let busy = 0;
    for (let i = before; i < at; i++) busy += d[i];
    if (at > before && busy / (at - before) > peak / 8) continue;
    const delay = at / sampleRate + recordStart - t;
    // No real device answers in under 2 ms: that's a sound that was already there.
    if (delay >= 0.002) delays.push(delay);
  }
  if (delays.length < Math.ceil(clickTimes.length * 0.6)) return { seconds: null, found: delays.length, spreadMs: 0, sure: false };
  delays.sort((x, y) => x - y);
  const median = delays[Math.floor(delays.length / 2)];
  // Clicks that agree with the median to within 2 ms.
  const close = delays.filter((x) => Math.abs(x - median) <= 0.002);
  const spreadMs = (delays[delays.length - 1] - delays[0]) * 1000;
  const sure = close.length >= Math.ceil(clickTimes.length * 0.6);
  return { seconds: sure ? close.reduce((s, x) => s + x, 0) / close.length : null, found: delays.length, spreadMs, sure };
}

/**
 * Line a recording up with the beat.
 *
 * The singer hears the beat's starting point (`from`) at `beatStartTime`,
 * and what they sing then reaches the recorder `latency` seconds later.
 * So the recording is cut (or padded with silence) to start exactly there:
 * sample 0 of the result sits on the beat at `from`.
 *
 * @param {Float32Array} recording
 * @param {number} sampleRate
 * @param {{ recordStart: number, beatStartTime: number, latency: number }} t  all on one clock, seconds
 * @returns {Float32Array}
 */
export function alignTake(recording, sampleRate, { recordStart, beatStartTime, latency }) {
  const skip = Math.round((beatStartTime + latency - recordStart) * sampleRate);
  if (skip >= 0) return recording.slice(Math.min(skip, recording.length));
  const out = new Float32Array(recording.length - skip);
  out.set(recording, -skip);
  return out;
}

/**
 * Put recorded chunks back together by their timestamps. Missing chunks
 * (the browser was busy) become silence, so the timing never slips.
 * @param {{ frame: number, data: Float32Array }[]} chunks  frame: the audio clock, in samples
 * @returns {{ samples: Float32Array, firstFrame: number }}
 */
export function joinChunks(chunks) {
  if (!chunks.length) return { samples: new Float32Array(0), firstFrame: 0 };
  const firstFrame = chunks[0].frame;
  const last = chunks[chunks.length - 1];
  const samples = new Float32Array(last.frame + last.data.length - firstFrame);
  for (const c of chunks) samples.set(c.data, c.frame - firstFrame);
  return { samples, firstFrame };
}
