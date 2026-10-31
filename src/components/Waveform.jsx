import { useEffect, useReducer, useRef } from "react";

/**
 * Draws a track's waveform: gold bars, brighter for the part already played,
 * a white playhead line and a small marker at the cue point.
 * Click or tap anywhere on it to jump there.
 */
export function Waveform({ peaks, progress, cue, onSeek, label, hotCues = [], loop = null }) {
  const canvasRef = useRef(null);
  // Redraw when the window (and so the canvas) changes size.
  const [size, resized] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    if (!peaks) {
      ctx.fillStyle = "rgba(212, 166, 74, 0.25)";
      ctx.fillRect(0, mid - 0.5, width, 1);
      return;
    }

    const bars = peaks.max.length;
    const playedX = progress * width;
    // A loop that's playing: a light band behind the waveform.
    if (loop) {
      ctx.fillStyle = "rgba(120, 200, 160, 0.22)";
      ctx.fillRect(loop.from * width, 0, Math.max(2, (loop.to - loop.from) * width), height);
    }
    for (let x = 0; x < width; x++) {
      const i = Math.min(bars - 1, Math.floor((x / width) * bars));
      const top = mid - peaks.max[i] * mid * 0.95;
      const bottom = mid - peaks.min[i] * mid * 0.95;
      ctx.fillStyle = x < playedX ? "#f3cf7a" : "rgba(212, 166, 74, 0.45)";
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }

    // Cue marker: a small gold triangle at the top.
    const cueX = cue * width;
    ctx.fillStyle = "#d4a64a";
    ctx.beginPath();
    ctx.moveTo(cueX - 5, 0);
    ctx.lineTo(cueX + 5, 0);
    ctx.lineTo(cueX, 7);
    ctx.closePath();
    ctx.fill();

    // Hot cues: a numbered tag at the bottom.
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    hotCues.forEach((c, i) => {
      if (c === null || c === undefined) return;
      const x = c * width;
      ctx.fillStyle = "#78c8a0";
      ctx.fillRect(Math.round(x), height - 14, 1, 14);
      ctx.fillRect(Math.round(x) - 6, height - 14, 12, 12);
      ctx.fillStyle = "#000";
      ctx.fillText(String(i + 1), Math.round(x), height - 4);
    });

    // Playhead.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(playedX) - 1, 0, 2, height);
  }, [peaks, progress, cue, size, hotCues, loop]);

  function seekFrom(event) {
    if (!peaks) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek((event.clientX - rect.left) / rect.width);
  }

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      role="img"
      aria-label={label}
      onPointerDown={seekFrom}
    />
  );
}
