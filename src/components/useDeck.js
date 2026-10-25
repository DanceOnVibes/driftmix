import { useEffect, useReducer } from "react";

/**
 * Keeps a React component in step with a deck: redraws when something changes
 * (track loaded, play, pause, cue), and about 30 times a second while playing
 * so the time and the playhead move smoothly.
 */
export function useDeck(deck) {
  const [, refresh] = useReducer((n) => n + 1, 0);

  useEffect(() => deck.subscribe(refresh), [deck]);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (time) => {
      if (deck.playing && time - last > 33) {
        last = time;
        refresh();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [deck]);

  return deck;
}
