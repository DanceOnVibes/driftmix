# DriftMix

Free, simple DJ transition tool by [The Drift3r](https://thedrift3r.com). Load two tracks, see BPM and Camelot key, and blend them beat-matched with one click. Runs in your browser; your music never leaves your computer.

Built under DanceOnVibes Limited. Free and open source under the AGPL-3.0.

## Where it is up to

| Step | What | Status |
|---|---|---|
| 1 | thedrift3r.com home page with "DriftMix: coming soon" | Done |
| 2 | Two decks: load tracks, waveforms, play, pause, cue, volume, crossfader | **This version** |
| 3 | BPM and key detection, Camelot codes | Next |
| 4 | Compatibility light and fix suggestions | |
| 5 | Transition button: beat-match, 8/16/32-bar blend, bass swap | |
| 6 | Launch at thedrift3r.com/driftmix | |

## How it works

- **React + Vite**, plain JavaScript (JSX). No server code, no database, no accounts.
- **Audio:** the browser's own Web Audio. Each deck: track → volume → crossfader → speakers.
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
| `src/lib/lib.test.js` | Tests for the above (`npm test`) |
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
