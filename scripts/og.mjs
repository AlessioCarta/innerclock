// Renders public/og.png — the 1200×630 link preview for WhatsApp, X, etc.
// Run with `npm run og` after changing the design. Uses system fonts.
import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const tiers = ["#a855f7", "#22c55e", "#eab308", "#a855f7", "#22c55e"];
const squares = tiers
  .map((c, i) => `<rect x="${100 + i * 92}" y="420" width="76" height="76" rx="14" fill="${c}"/>`)
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg" cx="50%" cy="-10%" r="90%">
      <stop offset="0" stop-color="#2a1f55"/>
      <stop offset="0.6" stop-color="#0b0a12"/>
    </radialGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#f472b6"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>

  <g transform="translate(100 78)">
    <circle cx="22" cy="22" r="16" fill="none" stroke="#2b2740" stroke-width="7"/>
    <path d="M22 6 A16 16 0 1 1 6 22" fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round"/>
    <text x="56" y="34" font-family="Helvetica Neue" font-weight="bold" font-size="34" fill="#f3f1fa">InnerClock</text>
  </g>

  <text x="100" y="228" font-family="Helvetica Neue" font-weight="bold" font-size="76" letter-spacing="-3" fill="#f3f1fa">How accurate is your</text>
  <text x="100" y="318" font-family="Helvetica Neue" font-weight="bold" font-size="76" letter-spacing="-3" fill="url(#g)">inner clock?</text>
  <text x="100" y="378" font-family="Helvetica Neue" font-size="30" fill="#9a94b3">Hold for exactly the time shown. No timer.</text>

  ${squares}
  <text x="580" y="472" font-family="Helvetica Neue" font-weight="bold" font-size="56" fill="#f3f1fa">431<tspan font-size="30" fill="#9a94b3">/500</tspan></text>

  <g transform="translate(870 140)">
    <circle cx="140" cy="140" r="150" fill="#a78bfa" opacity="0.18"/>
    <circle cx="140" cy="140" r="118" fill="url(#g)"/>
    <text x="140" y="152" text-anchor="middle" font-family="Helvetica Neue" font-weight="bold" font-size="30" letter-spacing="9" fill="#1e1036">HOLD</text>
  </g>

  <text x="100" y="570" font-family="Helvetica Neue" font-size="26" fill="#9a94b3">Free daily game · same 5 targets for everyone · alessiocarta.github.io/innerclock</text>
</svg>`;

const png = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Helvetica Neue" } }).render().asPng();
await writeFile(new URL("../public/og.png", import.meta.url), png);
console.log(`public/og.png ${(png.length / 1024).toFixed(0)} KB`);
