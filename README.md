# DriftMix

Free, simple DJ transition tool by [The Drift3r](https://thedrift3r.com). Load two tracks, see BPM and Camelot key, and blend them beat-matched with one click. Runs in your browser; your music never leaves your computer.

Built under DanceOnVibes Limited. Free and open source under the AGPL-3.0.

## Where it is up to

| Step | What | Status |
|---|---|---|
| 1 | thedrift3r.com home page with "DriftMix: coming soon" | Done |
| 2 | Two decks: load tracks, waveforms, play, pause, cue, volume, crossfader | Done |
| 3 | BPM and key detection, Camelot codes | **This version** |
| 4 | Compatibility light and fix suggestions | Next |
| 5 | Transition button: beat-match, 8/16/32-bar blend, bass swap | |
| 6 | Launch at thedrift3r.com/driftmix | |

## How it works

- **React + Vite**, plain JavaScript (JSX). No server code, no database, no accounts.
- **Audio:** the browser's own Web Audio. Each deck: track → volume → crossfader → speakers.
- **Tempo and key:** our own small detectors (no extra libraries), run in a background worker so playback never stutters. Tempo: a pulse line from the drums, then an exact beat grid fitted over the whole track (also finds where the beat lands, for step 5). Key: the notes between 100 Hz and 4 kHz, matched against the 24 key profiles (Krumhansl–Kessler). If it isn't sure it shows "?", and if it can't tell it says "Not found" rather than guess.
- **Privacy:** tracks are read from the computer with the browser's file reader and decoded in the page. Nothing is uploaded.
- **Hosting:** Cloudflare builds it (`npm install && npm run build`) and serves the `dist` folder. Branches get a preview link.

## Where things live

| File | What it is |
|---|---|
| `src/App.jsx` | The page: header, the two decks, crossfader, footer |
| `src/components/DeckPanel.jsx` | One deck: load, track name and time, waveform, Play, Cue, Volume |
| `src/components/Waveform.jsx` | Draws the waveform; click to jump |
| `src/audio/engine.js` | The sound: decks, play/pause/cue/seek, volume, crossfader |
| `src/lib/peaks.js` | Turns a track into waveform bars |
| `src/lib/mixer.js` | Crossfader curve, time format, Cue button rules |
| `src/audio/analysis.js` | Sends a loaded track to the background worker for tempo and key |
| `src/audio/analysis.worker.js` | The background worker itself |
| `src/lib/tempo.js` | Tempo (BPM) and where the beat lands |
| `src/lib/key.js` | Key detection |
| `src/lib/camelot.js` | Keys ↔ Camelot codes (7A = D minor) |
| `src/lib/analyze.js` | Runs both detectors; hides weak answers, marks unsure ones |
| `src/lib/fft.js` | Splits sound into frequencies (used by both detectors) |
| `src/lib/lib.test.js`, `src/lib/analysis.test.js` | Tests (`npm test`) |
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
