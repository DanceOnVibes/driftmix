# DriftMix

Free, simple DJ transition tool by [The Drift3r](https://thedrift3r.com). Load two tracks, see BPM and Camelot key, and blend them beat-matched with one click. Runs in your browser; your music never leaves your computer.

**Live at [driftmix.app](https://driftmix.app).**

Built under DanceOnVibes Limited. Free and open source under the AGPL-3.0.

## Where it is up to

| Step | What | Status |
|---|---|---|
| 1 | thedrift3r.com home page with "DriftMix: coming soon" | Done |
| 2 | Two decks: load tracks, waveforms, play, pause, cue, volume, crossfader | Done |
| 3 | BPM and key detection, Camelot codes | Done |
| 4 | Compatibility light and fix suggestions | Done |
| 5 | Transition button: beat-match, 8/16/32-bar blend, bass swap | Done |
| 5b | Auto DJ: a playlist that mixes itself | Done |
| 5c | Files: convert, tag and tidy tracks | Done |
| 5d | Files: exact BPM, key shift, tempo-drift check | Done |
| 6 | Vocal Booth: record your voice over a beat, clean and natural | Done |
| 6b | Pitch correction you control (amount and speed) | Done |
| 7 | Echo-out bridge, tempo journey, record the set | Done |
| 8 | Launch at driftmix.app | Done |

## How it works

- **React + Vite**, plain JavaScript (JSX). No server code, no database, no accounts.
- **Audio:** the browser's own Web Audio. Each deck: track → volume → crossfader → speakers.
- **Tempo and key:** our own small detectors (no extra libraries), run in a background worker so playback never stutters. Tempo: a pulse line from the drums, then an exact beat grid fitted over the whole track (also finds where the beat lands, for step 5). Key: the notes between 100 Hz and 4 kHz, matched against the 24 key profiles (Krumhansl–Kessler). If it isn't sure it shows "?", and if it can't tell it says "Not found" rather than guess.
- **Match light:** green, amber or red for the two tracks. Tempo: up to 3% apart is green, up to 6% amber (half and double time count). Key on the Camelot wheel: same, one step or A/B swap is green; two steps or a diagonal is amber; anything else red. It suggests a fix: the BPM range to pick from, a ±1 or ±2 semitone shift, or the friendly keys. The playing deck counts as "now".
- **Transition button:** the next track is time-stretched to the playing tempo with key lock (our own WSOLA stretch, made in a background worker before you press), optionally shifted ±1/±2 semitones to fix the key, started exactly on the playing track's next bar on its own beat, blended equal-power over 8, 16 or 32 bars, with the bass swapped half way. Then the old track stops and the crossfader moves over. Touching a deck or pressing Cancel puts things back.
- **Files order:** the same Order by choice puts the Files list in order before converting, so the track numbers follow (an album that climbs from 124 to 138).
- **Auto DJ:** add tracks (read one at a time in the background, then the decoded audio is let go), "Order for a smooth set" by **flowing keys** (round the Camelot wheel; first track stays first) or by **tempo**, slow → fast or fast → slow (keys only break near-ties within 1 BPM); Undo puts the old order back, Start. Near the end of each track it presses Mix (key fix on) and loads the next track onto the deck that just finished. The whole set is locked to the first track's tempo; tracks more than 6% away are skipped. Touching a deck hands control back.
- **Tight beats:** analysis also finds the downbeat (bar one, from where chords and bass change). Just before every mix, tempo and beats are re-measured in the exact stretch about to play, for both tracks, and the start points snap to the real beats (produced tracks drift a little; 0.1 BPM off is ~20 ms by the end of a 16-bar blend). Auto DJ starts its mixes on 8-bar phrase lines and blends "?" tracks over 8 bars.
- **Mid (vocal) swap:** alongside the bass swap, the incoming track's mids (≈400 Hz–3.5 kHz, where vocals sit) are dipped 18 dB until half way, so two voices don't talk over each other; you hear its groove first, as a hint.
- **Set tempo:** Auto DJ locks the set to the first track's tempo or one you pick (120–150); skipped tracks say exactly why.
- **Files:** MP3 (LAME via lamejs, 128–320 kbps) or WAV (16/24-bit), sample rate (original, 44.1 or 48 kHz, using the browser's own resampler), stereo or mono, titles and tags (ID3v2.3 in MP3; LIST/INFO + id3 chunk in WAV) with BPM, key, Camelot, cover art, copyright and a comment, loudness levelled to −14 or −9 LUFS (BS.1770 meter, peaks kept under −1 dB, no limiter), silence trimmed, smart file names, download one, all (zip) or share on a phone.
- **Files → Auto DJ:** "Send to Auto DJ" carries each track's title, exact BPM and key shift. Auto DJ builds them into the audio as it loads the track (the same stretch and resample as Convert), so the decks play it exactly as set; sending again brings the playlist up to date instead of doubling it.
- **Build-up:** a third way to mix (next to Mix and Echo out). On the phrase line a one-beat snippet repeats in time and gets faster (every 2 beats, 1, ½, ¼, ⅛), on its own channel with kick and bass filtered out, while a riser climbs and the playing track thins out and gets quieter. The last beat is a breath (only echoes), then the next track drops on its first beat. The snippet is the beat with the strongest middle (300 Hz–3 kHz, voices and leads): from the track coming in (after its 16-bar intro, a taste of its hook) or the track going out (its last 4 bars). Auto DJ can do it every mix or every third mix, the snippet taking turns.
- **Samples:** cut a loop or one-shot from a track on a deck: tap the waveform (8 bars around the sample, beats and bars marked, whole track above), it snaps to the beat or half beat; ½, 1, 2, 4, 8 or 16 beats; optionally cut bass and kick (24 dB/oct at 250 Hz, settled before the start). The length comes from the tempo in whole samples (4 beats at 128 BPM at 48 kHz = exactly 90000). Preview once or looping. 8 pads (keys 1–8 too): a pad plays on the next beat (half beat for ½-beat samples) of the playing track, stretched to its tempo. Save a pad as a 24-bit WAV named "Track - 4 beats - 134 BPM 9B.wav" with BPM and key in the tags (on a USB stick it loops cleanly with Beat Loop on a CDJ/XDJ), or all pads in a zip; or use a pad as a Build-up's snippet. Pads are kept on the device.
- **Hot cues and loops:** 4 hot cues per deck, set on the nearest beat and kept on the device per track; a jump lands as far into the cue's beat as the playhead was into its own (quantize), with a 10 ms cross-fade. Beat loops of ½–16 beats start on the beat the playhead is in, use the browser's own sample-exact looping, resize keeping their start, and let go without a jump.
- **Undo after Clear:** clearing the Files list, the playlist or a pad shows "Cleared · Undo" for 10 seconds.
- **Install as an app:** web app manifest and a service worker (`src/sw.js`, filled in by `vite.config.js` with the version and every file). Installs from Chrome/Edge/Android (Install app) or Share › Add to Home Screen on iPhone; opens with no internet; when a new version has been saved, "A new version of DriftMix is ready · Update". The page itself is never cached stale (`_headers`).
- **Demo:** with `public/demo/demo.json` and its tracks, Auto DJ shows "Hear a demo mix": one tap loads them and starts the set. No demo.json, no button.
- **Kept after a refresh:** the Files list and the Auto DJ playlist (tracks, titles, exact BPM, key shifts, readings and Auto DJ settings) are kept in the browser's own storage (IndexedDB) on this device, each track stored once, and put back when the page opens. Clearing a list removes its tracks from storage. Converted files aren't kept.
- **Privacy:** tracks are read from the computer with the browser's file reader and decoded in the page. Nothing is uploaded; kept lists stay in this browser on this device.
- **Hosting:** Cloudflare builds it (`npm install && npm run build`) and serves the `dist` folder. Branches get a preview link.

## Where things live

| File | What it is |
|---|---|
| `src/App.jsx` | The page: header, the two decks, crossfader, footer |
| `src/components/DeckPanel.jsx` | One deck: load, track name and time, waveform, Play, Cue, Volume |
| `src/components/MatchPanel.jsx` | The match light under the decks |
| `src/components/TransitionPanel.jsx` | Mix button, blend length, key fix, progress |
| `src/components/AutoDjPanel.jsx` | Auto DJ: playlist, order, start/stop |
| `src/components/FilesPanel.jsx` | Files: settings, tags, list, convert, download |
| `src/components/Waveform.jsx` | Draws the waveform; click to jump |
| `src/audio/engine.js` | The sound: decks, play/pause/cue/seek, volume, bass EQ, crossfader |
| `src/lib/peaks.js` | Turns a track into waveform bars |
| `src/lib/mixer.js` | Crossfader curve, time format, Cue button rules |
| `src/audio/analysis.js` | Sends work to the background workers: tempo and key, and stretched copies |
| `src/audio/analysis.worker.js` | The background worker itself |
| `src/lib/tempo.js` | Tempo (BPM) and where the beat lands |
| `src/lib/key.js` | Key detection |
| `src/lib/camelot.js` | Keys ↔ Camelot codes (7A = D minor) |
| `src/audio/transition.js` | Runs a transition: prepares, schedules the blend and bass swap, finishes or cancels |
| `src/lib/transition.js` | Transition maths: start on the bar, speeds, blend length, fade curves |
| `src/lib/stretch.js` | Time-stretch with key lock (WSOLA) |
| `src/audio/autodj.js` | Runs the Auto DJ set: reads tracks, loads decks, triggers each mix |
| `src/lib/setlist.js` | Set order (flowing keys, tempo lock) and when to mix out |
| `src/audio/files.js`, `src/audio/files.worker.js` | Files: reading, resampling, converting in the background |
| `src/lib/sampler.js`, `src/audio/sampler.js`, `src/components/SamplerPanel.jsx` | Samples: cutting on the beat, pads, WAV export |
| `src/lib/buildup.js` | Build-up: the roll's timing and picking the snippet |
| `src/audio/keep.js` | Keeps the Files list and Auto DJ playlist on this device after a refresh |
| `src/lib/files/` | WAV and MP3 writers, ID3 tags, zip, loudness meter, silence trim, names, format sniffing (+ tests) |
| `src/vendor/lame.js` | lamejs (LAME MP3 encoder), LGPL — see `LAME-LICENSE` |
| `src/lib/match.js` | Match light rules: tempo and key verdicts, fix suggestions |
| `src/lib/analyze.js` | Runs both detectors; hides weak answers, marks unsure ones |
| `src/lib/downbeat.js` | Finds bar one (the downbeat) |
| `src/lib/fft.js` | Splits sound into frequencies (used by both detectors) |
| `src/lib/lib.test.js`, `src/lib/analysis.test.js`, `src/lib/match.test.js`, `src/lib/transition.test.js`, `src/lib/setlist.test.js` | Tests (`npm test`) |
| `src/lib/test-synth.js` | Makes test tracks with known tempo and key, for the tests only |
| `public/_headers` | Security rules (the page loads nothing from other sites) |
| `wrangler.jsonc` | Cloudflare settings |

## Run it on your own computer

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev     # opens a local copy you can try
npm test        # runs the tests
```

## Rules

- Work on a branch, open a pull request, merge into `main` only when ready. Merging = live.
- Tracks never leave the user's computer. No uploads, no tracking.
- Audio libraries are checked for their licence before use.
