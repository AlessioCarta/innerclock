// Renders the iOS app icon (1024², opaque — Apple rejects alpha) and splash screens.
// Run with `npm run app-icons` after changing the logo.
import { writeFile, rename, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const assets = new URL("../ios/App/App/Assets.xcassets/", import.meta.url);

const defs = `<defs>
  <radialGradient id="bg" cx="50%" cy="0%" r="100%">
    <stop offset="0" stop-color="#2a1f55"/><stop offset="0.7" stop-color="#0b0a12"/>
  </radialGradient>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#f472b6"/>
  </linearGradient>
</defs>`;

// Same mark as public/icon.svg, full-bleed square (iOS applies its own mask).
const mark = (cx, cy, r, w) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2b2740" stroke-width="${w}"/>
  <path d="M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx - r} ${cy}" fill="none" stroke="url(#g)" stroke-width="${w}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${w * 0.6}" fill="url(#g)"/>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${defs}
  <rect width="1024" height="1024" fill="url(#bg)"/>${mark(512, 512, 300, 88)}</svg>`;

const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732">${defs}
  <rect width="2732" height="2732" fill="#0b0a12"/>${mark(1366, 1366, 180, 54)}</svg>`;

const png = (svg) => new Resvg(svg, { background: "#0b0a12" }).render().asPng();

const iconUrl = new URL("AppIcon.appiconset/AppIcon-512@2x.png", assets);
const tmp = new URL("AppIcon.appiconset/tmp-rgba.png", assets);
await writeFile(tmp, png(icon));
// Drop the alpha channel (App Store Connect rejects icons with transparency). Needs ffmpeg.
const iconPath = fileURLToPath(iconUrl);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", fileURLToPath(tmp), "-pix_fmt", "rgb24", iconPath + ".rgb.png"]);
await rename(iconPath + ".rgb.png", iconPath);
await unlink(tmp);
const s = png(splash);
for (const f of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await writeFile(new URL(`Splash.imageset/${f}`, assets), s);
}
console.log("iOS icon + splash written");
