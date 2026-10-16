// 1080×1920 result card for Instagram/TikTok/WhatsApp stories, drawn on a canvas.
import { errorPct, tierFor, roundScore } from "./core.js";

const W = 1080;
const H = 1920;
const FONT = '"Space Grotesk", system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function gradient(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, "#a78bfa");
  g.addColorStop(1, "#f472b6");
  return g;
}

/** Returns a PNG Blob of the player's result card. */
export async function storyImage({ day, targets, actuals, total, title, username, url }) {
  await document.fonts?.ready;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  const bg = ctx.createRadialGradient(W / 2, -200, 100, W / 2, 400, 1500);
  bg.addColorStop(0, "#2e2160");
  bg.addColorStop(0.55, "#0b0a12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Logo
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#2b2740";
  ctx.beginPath();
  ctx.arc(W / 2 - 170, 210, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = gradient(ctx, W / 2 - 200, 180, W / 2 - 140, 240);
  ctx.beginPath();
  ctx.arc(W / 2 - 170, 210, 30, -Math.PI / 2, Math.PI);
  ctx.stroke();
  ctx.fillStyle = "#f3f1fa";
  ctx.font = `700 64px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("InnerClock", W / 2 - 115, 232);
  ctx.textAlign = "center";

  ctx.fillStyle = "#a78bfa";
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText(`DAILY CHALLENGE #${day}`, W / 2, 360);

  // Score
  ctx.fillStyle = "#f3f1fa";
  ctx.font = `700 300px ${FONT}`;
  ctx.fillText(String(total), W / 2, 680);
  ctx.fillStyle = "#9a94b3";
  ctx.font = `600 64px ${FONT}`;
  ctx.fillText("out of 500", W / 2, 770);

  ctx.fillStyle = gradient(ctx, 200, 820, 880, 900);
  ctx.font = `700 76px ${FONT}`;
  ctx.fillText(title, W / 2, 900);

  // Tier squares
  const size = 150;
  const gap = 26;
  const x0 = (W - (size * 5 + gap * 4)) / 2;
  targets.forEach((t, i) => {
    ctx.fillStyle = tierFor(errorPct(t, actuals[i])).color;
    roundRect(ctx, x0 + i * (size + gap), 990, size, size, 30);
  });

  // Rounds table: target → held, offset, points
  ctx.font = `500 42px ${FONT}`;
  targets.forEach((t, i) => {
    const a = actuals[i];
    const y = 1260 + i * 72;
    const d = a - t;
    ctx.fillStyle = "#9a94b3";
    ctx.textAlign = "right";
    ctx.fillText(`${t.toFixed(1)}s`, 400, y);
    ctx.fillStyle = "#f3f1fa";
    ctx.textAlign = "center";
    ctx.fillText(`→ ${a.toFixed(2)}s`, 600, y);
    ctx.fillStyle = Math.abs(d / t) <= 0.05 ? "#34d399" : "#9a94b3";
    ctx.textAlign = "left";
    ctx.fillText(`${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`, 760, y);
    ctx.fillStyle = "#6b6585";
    ctx.textAlign = "right";
    ctx.fillText(`${roundScore(t, a)}`, 1010, y);
  });
  ctx.textAlign = "center";

  // Call to action
  ctx.fillStyle = "#1a1728";
  roundRect(ctx, 90, 1660, W - 180, 170, 40);
  ctx.fillStyle = "#f3f1fa";
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(username ? `Beat @${username}` : "Can you beat me?", W / 2, 1735);
  ctx.fillStyle = "#a78bfa";
  ctx.font = `500 38px ${FONT}`;
  ctx.fillText(url.replace(/^https?:\/\//, "").replace(/\/$/, ""), W / 2, 1795);

  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}
