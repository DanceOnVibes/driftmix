/**
 * The mix card: after a recorded set, a picture to post — the set's length,
 * tracks, tempo, key path and tracklist with times, in DriftMix's colours.
 * Drawn on this device (a canvas), 1080 × 1350 for Instagram and the like.
 * It holds no audio: only the names and numbers already in the tracklist.
 */
import { cardLayout } from "../lib/mixCard.js";

const W = 1080;
const H = 1350;
const PAD = 80;
const C = { bg: "#050403", raised: "#0e0b07", line: "rgba(212, 166, 74, 0.35)", gold: "#d4a64a", bright: "#f3cf7a", silver: "#dcdde3", text: "#c9c6bf", muted: "#8d877b" };
const SERIF = '"Didot", "Bodoni 72", "Playfair Display", Georgia, "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Cut text to fit a width, with an ellipsis. */
function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid).trimEnd() + "…").width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param {{ title: string, by?: string, date: Date, seconds: number, entries: object[] }} set
 * @returns {Promise<Blob>} a PNG
 */
export async function drawMixCard({ title, by = "", date, seconds, entries }) {
  const card = cardLayout(entries, seconds);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background: warm black, a soft gold glow, a thin gold frame.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 120, 20, W * 0.85, 120, 700);
  glow.addColorStop(0, "rgba(212, 166, 74, 0.16)");
  glow.addColorStop(1, "rgba(212, 166, 74, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  roundRect(ctx, 32, 32, W - 64, H - 64, 28);
  ctx.stroke();

  // DriftMix by The Drift3r
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f2efe9";
  ctx.font = `400 84px ${SERIF}`;
  ctx.fillText("DriftMix", PAD, 150);
  const brandW = ctx.measureText("DriftMix").width;
  ctx.fillStyle = C.gold;
  ctx.font = `500 30px ${SANS}`;
  ctx.fillText("by The Drift3r", PAD + brandW + 22, 150);

  // The set's title, who mixed it, the date.
  ctx.fillStyle = C.silver;
  ctx.font = `700 54px ${SANS}`;
  ctx.fillText(fit(ctx, title || "My DriftMix set", W - 2 * PAD), PAD, 250);
  ctx.fillStyle = C.muted;
  ctx.font = `400 28px ${SANS}`;
  const when = date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  ctx.fillText(fit(ctx, by ? `Mixed by ${by} · ${when}` : when, W - 2 * PAD), PAD, 298);

  // Length · tracks · tempo
  const stats = [
    ["LENGTH", card.length],
    ["TRACKS", String(card.tracks)],
    ...(card.tempo ? [["TEMPO", card.tempo]] : []),
  ];
  const colW = (W - 2 * PAD) / 3;
  stats.forEach(([label, value], i) => {
    const x = PAD + i * colW;
    ctx.fillStyle = C.gold;
    ctx.font = `600 22px ${SANS}`;
    ctx.fillText(label.split("").join(String.fromCharCode(8202)), x, 380);
    ctx.fillStyle = C.bright;
    ctx.font = `700 42px ${SANS}`;
    ctx.fillText(fit(ctx, value, i === 2 ? W - PAD - x : colW - 20), x, 432);
  });

  // The key path, as gold chips with arrows.
  let y = 500;
  if (card.keyPath.length) {
    ctx.fillStyle = C.gold;
    ctx.font = `600 22px ${SANS}`;
    ctx.fillText("KEY PATH".split("").join(String.fromCharCode(8202)), PAD, y);
    y += 22;
    let x = PAD;
    ctx.font = `700 28px ${SANS}`;
    card.keyPath.forEach((k, i) => {
      const w = k === "…" ? ctx.measureText("…").width + 8 : ctx.measureText(k).width + 34;
      const arrow = i < card.keyPath.length - 1 ? 40 : 0;
      if (x + w > W - PAD) {
        x = PAD;
        y += 58;
      }
      if (k === "…") {
        ctx.fillStyle = C.muted;
        ctx.fillText("…", x + 4, y + 36);
      } else {
        roundRect(ctx, x, y + 4, w, 44, 22);
        ctx.fillStyle = "rgba(212, 166, 74, 0.14)";
        ctx.fill();
        ctx.strokeStyle = "rgba(212, 166, 74, 0.55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = C.bright;
        ctx.fillText(k, x + 17, y + 36);
      }
      x += w;
      if (arrow && x + arrow < W - PAD) {
        ctx.fillStyle = C.muted;
        ctx.fillText("→", x + 7, y + 36);
        x += arrow;
      }
    });
    y += 90;
  } else y += 10;

  // The tracklist: time, name, key.
  ctx.strokeStyle = "rgba(212, 166, 74, 0.25)";
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 16;
  const step = card.size === 40 ? 50 : 40;
  const bottom = H - 150;
  for (const line of card.lines) {
    y += step;
    if (y > bottom) break;
    ctx.font = `600 ${card.size - 8}px ${SANS}`;
    ctx.fillStyle = C.gold;
    ctx.fillText(line.time, PAD, y);
    const timeW = card.size === 40 ? 150 : 135;
    ctx.font = `700 ${card.size - 6}px ${SANS}`;
    const keyW = line.key ? ctx.measureText(line.key).width : 0;
    ctx.fillStyle = C.bright;
    if (line.key) ctx.fillText(line.key, W - PAD - keyW, y);
    ctx.font = `500 ${card.size - 6}px ${SANS}`;
    ctx.fillStyle = C.text;
    ctx.fillText(fit(ctx, line.name, W - 2 * PAD - timeW - keyW - 30), PAD + timeW, y);
  }
  if (card.more) {
    y += step;
    ctx.font = `500 ${card.size - 8}px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(`+ ${card.more} more`, PAD + (card.size === 40 ? 150 : 135), Math.min(y, bottom));
  }

  // Footer
  ctx.strokeStyle = "rgba(212, 166, 74, 0.25)";
  ctx.beginPath();
  ctx.moveTo(PAD, H - 120);
  ctx.lineTo(W - PAD, H - 120);
  ctx.stroke();
  ctx.font = `600 28px ${SANS}`;
  ctx.fillStyle = C.gold;
  ctx.fillText("Mixed in DriftMix · driftmix.app", PAD, H - 70);
  ctx.font = `400 24px ${SANS}`;
  ctx.fillStyle = C.muted;
  const note = "Free · nothing uploaded";
  ctx.fillText(note, W - PAD - ctx.measureText(note).width, H - 70);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}
