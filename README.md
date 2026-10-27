# DriftMix

Free, simple DJ transition tool by [The Drift3r](https://thedrift3r.com). Load two tracks, see BPM and Camelot key, and blend them beat-matched with one click. Runs in your browser; your music never leaves your computer.

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
| 5c | Files: convert, tag and tidy tracks | **This version** |
| 5d | Record the set + tempo journey | Next |
| 6 | Launch at thedrift3r.com/driftmix | Next |

## How it works

- **React + Vite**, plain JavaScript (JSX). No server code, no database, no accounts.
- **Audio:** the browser's own Web Audio. Each deck: track → volume → crossfader → speakers.
- **Tempo and key:** our own small detectors (no extra libraries), run in a background worker so playback never stutters. Tempo: a pulse line from the drums, then an exact beat grid fitted over the whole track (also finds where the beat lands, for step 5). Key: the notes between 100 Hz and 4 kHz, matched against the 24 key profiles (Krumhansl–Kessler). If it isn't sure it shows "?", and if it can't tell it says "Not found" rather than guess.
- **Match light:** green, amber or red for the two tracks. Tempo: up to 3% apart is green, up to 6% amber (half and double time count). Key on the Camelot wheel: same, one step or A/B swap is green; two steps or a diagonal is amber; anything else red. It suggests a fix: the BPM range to pick from, a ±1 or ±2 semitone shift, or the friendly keys. The playing deck counts as "now".
- **Transition button:** the next track is time-stretched to the playing tempo with key lock (our own WSOLA stretch, made in a background worker before you press), optionally shifted ±1/±2 semitones to fix the key, started exactly on the playing track's next bar on its own beat, blended equal-power over 8, 16 or 32 bars, with the bass swapped half way. Then the old track stops and the crossfader moves over. Touching a deck or pressing Cancel puts things back.
- **Auto DJ:** add tracks (read one at a time in the background, then the decoded audio is let go), "Order for a smooth set" (keys flow round the Camelot wheel; first track stays first), Start. Near the end of each track it presses Mix (key fix on) and loads the next track onto the deck that just finished. The whole set is locked to the first track's tempo; tracks more than 6% away are skipped. Touching a deck hands control back.
- **Tight beats:** analysis also finds the downbeat (bar one, from where chords and bass change). Just before every mix, tempo and beats are re-measured in the exact stretch about to play, for both tracks, and the start points snap to the real beats (produced tracks drift a little; 0.1 BPM off is ~20 ms by the end of a 16-bar blend). Auto DJ starts its mixes on 8-bar phrase lines and blends "?" tracks over 8 bars.
- **Mid (vocal) swap:** alongside the bass swap, the incoming track's mids (≈400 Hz–3.5 kHz, where vocals sit) are dipped 18 dB until half way, so two voices don't talk over each other; you hear its groove first, as a hint.
- **Set tempo:** Auto DJ locks the set to the first track's tempo or one you pick (120–150); skipped tracks say exactly why.
- **Files:** MP3 (LAME via lamejs, 128–320 kbps) or WAV (16/24-bit), sample rate (original, 44.1 or 48 kHz, using the browser's own resampler), stereo or mono, titles and tags (ID3v2.3 in MP3; LIST/INFO + id3 chunk in WAV) with BPM, key, Camelot, cover art, copyright and a comment, loudness levelled to −14 or −9 LUFS (BS.1770 meter, peaks kept under −1 dB, no limiter), silence trimmed, smart file names, download one, all (zip) or share on a phone.
- **Privacy:** tracks are read from the computer with the browser's file reader and decoded in the page. Nothing is uploaded.
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
