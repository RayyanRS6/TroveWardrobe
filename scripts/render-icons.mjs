// Renders Trove's app icons from the SVG sources in public/icons/.
//
//   npm run icons
//
// Sources (edit these, then re-run and commit the results):
//   icons/icon.svg        the icon, also served as the SVG favicon
//   icons/icon-small.svg  the same drawing tuned for 16 and 32 px
//
// Writes, under public/:
//   icons/icon-192.png          manifest icon (purpose "any")
//   icons/icon-512.png          manifest icon (purpose "any")
//   icons/maskable-512.png      manifest icon (purpose "maskable"): full-bleed
//                               background, mark inside the 80% safe zone
//   icons/apple-touch-icon.png  180 px, opaque (iOS rounds the corners itself)
//   favicon.ico                 16 and 32 px PNGs in an ICO container
//   manifest.webmanifest        icon URLs stamped with ?v=<hash of the file>
//
// Android draws the launch splash from the manifest's background_color plus
// one of these icons, so the tile colour must equal background_color: then
// the tile's edges vanish and the splash is one plain screen with the mark
// centred. The script refuses to render if the two drift apart.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const CANVAS = 512;
// The maskable safe zone is a centred circle 80% of the icon wide (radius
// 205 of 512). The mark's farthest point (a bar corner, 199 out) lands at
// 183 at this scale: inside with room to spare in a circular launcher mask,
// and no smaller than needed on the splash, which also uses this icon.
const MASKABLE_SCALE = 0.92;

function readSource(path) {
  return readFileSync(new URL(path, PUBLIC_DIR), "utf8");
}

/** Throws unless the icon's tile colour is the manifest's background_color. */
function checkSplashColour(source) {
  const markup = source.replace(/<!--[\s\S]*?-->/g, "");
  const tile = /<rect id="tile"[^>]*\sfill="([^"]+)"/.exec(markup)?.[1] ?? "";
  const background = JSON.parse(readSource("manifest.webmanifest")).background_color ?? "";
  if (tile.toLowerCase() !== background.toLowerCase()) {
    throw new Error(
      `icon.svg tile ${tile} must match manifest background_color ${background} (Android splash).`,
    );
  }
}

/**
 * The icon.svg mark on a square, full-bleed background, scaled about the
 * centre. Launchers (maskable) and iOS (apple-touch-icon) apply their own
 * shape, so these must be opaque to the edges.
 */
function fullBleed(source, scale) {
  const markup = source.replace(/<!--[\s\S]*?-->/g, "");
  const ink = /<rect id="tile"[^>]*\sfill="([^"]+)"/.exec(markup)?.[1];
  const mark = /<g id="mark"[\s\S]*<\/g>/.exec(markup)?.[0];
  if (!ink || !mark) {
    throw new Error('icon.svg needs <rect id="tile" fill="..."> and <g id="mark">.');
  }
  const centre = CANVAS / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    `<rect width="${CANVAS}" height="${CANVAS}" fill="${ink}"/>`,
    `<g transform="translate(${centre} ${centre}) scale(${scale}) translate(${-centre} ${-centre})">`,
    mark,
    "</g>",
    "</svg>",
  ].join("\n");
}

function renderPng(svg, width) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false }, // paths only
  });
  return resvg.render().asPng();
}

/**
 * An ICO file holding PNG images, which every current browser reads.
 * Layout: 6-byte ICONDIR, one 16-byte ICONDIRENTRY per image, then the PNGs.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0); // width (0 means 256)
    entry.writeUInt8(size % 256, 1); // height
    entry.writeUInt8(0, 2); // palette size: none
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

/**
 * Gives each manifest icon URL a hash of its file. public/sw.js serves
 * /icons/* cache-first by full URL, so a redrawn icon under an unchanged URL
 * would keep reaching installed apps (and their launch splash) as the old
 * file. A new URL misses that cache, and Chrome's update check for an
 * installed app sees the changed icon.
 */
function stampManifestIcons() {
  const path = "manifest.webmanifest";
  const stamped = readSource(path).replace(
    /"src": "\/(icons\/[^"?]+)(?:\?v=[0-9a-f]*)?"/g,
    (_, file) => {
      const hash = createHash("sha256").update(readFileSync(new URL(file, PUBLIC_DIR)));
      return `"src": "/${file}?v=${hash.digest("hex").slice(0, 10)}"`;
    },
  );
  writeFileSync(new URL(path, PUBLIC_DIR), stamped);
  console.log(`Wrote public/${path}`);
}

const icon = readSource("icons/icon.svg");
const small = readSource("icons/icon-small.svg");
checkSplashColour(icon);

const outputs = {
  "icons/icon-192.png": renderPng(icon, 192),
  "icons/icon-512.png": renderPng(icon, 512),
  "icons/maskable-512.png": renderPng(fullBleed(icon, MASKABLE_SCALE), 512),
  "icons/apple-touch-icon.png": renderPng(fullBleed(icon, 1), 180),
  "favicon.ico": ico([16, 32].map((size) => ({ size, png: renderPng(small, size) }))),
};
for (const [path, contents] of Object.entries(outputs)) {
  writeFileSync(new URL(path, PUBLIC_DIR), contents);
  console.log(`Wrote public/${path}`);
}
stampManifestIcons();
