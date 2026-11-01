// Studio bass tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { bassChain, responseDb, mudCutDb, bassBalance, autoBassDb, applyBass, limit, loudestStart, AUTO_MAX_DB, BASS_TARGET } from "./bass.js";

const sr = 44100;
const tone = (hz, seconds, amp = 0.5) => Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));
const rms = (a, from = 0) => Math.sqrt(a.subarray(from).reduce((s, v) => s + v * v, 0) / (a.length - from));
const peak = (chs) => Math.max(...chs.map((c) => c.reduce((p, v) => Math.max(p, Math.abs(v)), 0)));

test("the EQ: bass up, mud a little down, mids and highs untouched, rumble gone", () => {
  const total = (hz) => bassChain(sr, 4).reduce((db, f) => db + responseDb(f, hz, sr), 0);
  assert.ok(total(60) > 2.5 && total(40) > 2.5, `40–60 Hz up (${total(40).toFixed(2)}, ${total(60).toFixed(2)} dB)`);
  assert.ok(total(250) < 0, `250 Hz dipped (${total(250).toFixed(2)})`);
  assert.ok(Math.abs(total(2000)) < 0.15, `2 kHz untouched (${total(2000).toFixed(2)})`);
  assert.ok(Math.abs(total(8000)) < 0.1, "8 kHz untouched");
  assert.ok(total(12) < -5, `12 Hz rumble cut (${total(12).toFixed(2)})`);
  assert.equal(mudCutDb(4), -1.6);
  assert.equal(mudCutDb(10), -2.5, "the dip never goes past 2.5 dB");
});

test("Auto: a thin track gets more, a full one less, a bassy one nothing; never past the cap", () => {
  const mix = (bassAmp) => {
    const a = tone(80, 4, bassAmp);
    const b = tone(1500, 4, 0.3);
    return [a.map((v, i) => v + b[i])];
  };
  const thin = bassBalance(mix(0.15), sr);
  const full = bassBalance(mix(0.5), sr);
  const heavy = bassBalance(mix(1.2), sr);
  assert.ok(thin < full && full < heavy, `${thin.toFixed(1)} < ${full.toFixed(1)} < ${heavy.toFixed(1)}`);
  assert.ok(autoBassDb(thin) > autoBassDb(full), "thin gets more");
  assert.equal(autoBassDb(heavy), 0, "bassy gets nothing");
  assert.equal(autoBassDb(-40), AUTO_MAX_DB, "capped");
  assert.equal(autoBassDb(BASS_TARGET), 0);
  assert.equal(autoBassDb(BASS_TARGET - 2.2) % 0.5, 0, "half-dB steps");
  assert.equal(autoBassDb(NaN), 0);
});

test("applying it: more bass, same mids, and the limiter keeps peaks under −1 dB", () => {
  const n = sr * 3;
  const bass = tone(60, 3, 0.6);
  const mid = tone(1000, 3, 0.3);
  const L = bass.map((v, i) => v + mid[i]);
  const R = L.slice();
  const before = { bass: rms(bass), all: peak([L]) };
  assert.ok(before.all > 0.85, "starts near full scale");
  applyBass([L, R], sr, 5);
  assert.ok(peak([L, R]) <= 10 ** (-1 / 20) + 1e-6, `peak ${20 * Math.log10(peak([L, R]))} dB`);
  // The low end grew compared with the mids (measured after the filters settle).
  const lowNow = bassBalance([L.subarray(sr)], sr);
  const lowBefore = bassBalance([bass.map((v, i) => v + mid[i]).subarray(sr)], sr);
  assert.ok(lowNow > lowBefore + 1.5, `bass up against the mids: ${lowBefore.toFixed(1)} → ${lowNow.toFixed(1)} dB`);
  assert.equal(L.length, n);
  // 0 dB does nothing at all.
  const same = [tone(60, 1)];
  const copy = same[0].slice();
  applyBass(same, sr, 0);
  assert.deepEqual(same[0], copy);
});

test("limiter: leaves quiet audio alone, turns peaks down smoothly", () => {
  const q = [tone(200, 1, 0.5)];
  const c = q[0].slice();
  assert.equal(limit(q, sr, -1).reductionDb, 0);
  assert.deepEqual(q[0], c);
  const loud = [tone(200, 1, 1.4)];
  const r = limit(loud, sr, -1);
  assert.ok(peak(loud) <= 10 ** (-1 / 20) + 1e-6);
  assert.ok(r.reductionDb > 3 && r.reductionDb < 4.5, `about 3.9 dB (${r.reductionDb.toFixed(2)})`);
});

test("the drop: finds the loudest 20 seconds", () => {
  const quiet = tone(440, 30, 0.05);
  const loud = tone(440, 20, 0.6);
  const track = new Float32Array(quiet.length + loud.length + quiet.length);
  track.set(quiet, 0);
  track.set(loud, quiet.length);
  track.set(quiet, quiet.length + loud.length);
  assert.ok(Math.abs(loudestStart([track], sr, 20) - 30) <= 0.5, `${loudestStart([track], sr, 20)}`);
  assert.equal(loudestStart([tone(440, 5)], sr, 20), 0, "short tracks start at 0");
});
