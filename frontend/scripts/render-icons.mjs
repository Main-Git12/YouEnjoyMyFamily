/**
 * Renders public/icon.svg into the PNG sizes the web actually asks for.
 *
 * Kept as a script rather than a build step because these change about once
 * a year, and a headless Chromium in the build would cost every CI run
 * minutes to reproduce a file that is already committed. Re-run it by hand
 * (`npm run icons`) after editing icon.svg, and commit what it writes.
 *
 * Each size exists for a named reason:
 *   favicon-32.png   browser tab, and the one that made the old lockup a smudge
 *   apple-touch-icon-180.png  iOS home screen; must be opaque, iOS adds the rounding
 *   icon-192.png / icon-512.png  the manifest's `purpose: "any"` pair
 *   icon-maskable-512.png     `purpose: "maskable"`; Android crops this to a
 *                             circle, so the glyph is drawn smaller to stay
 *                             inside the safe zone
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");
const svg = readFileSync(resolve(publicDir, "icon.svg"), "utf8");

/**
 * How much the maskable variant pulls the glyph in.
 *
 * Android guarantees only the middle 80% of a maskable icon — a circle of
 * radius 205 on a 512 canvas — and crops the rest to whatever shape the
 * launcher likes. The glyph's half-diagonal at full size is about 240, so
 * the corners of the drawing would sit outside that circle. 0.8 brings the
 * half-diagonal to ~192 and leaves the margin the spec asks for.
 */
const MASKABLE_SCALE = 0.8;

/** Matches the scale factor in icon.svg's glyph transform, so the maskable
 *  variant is the same drawing at a smaller scale rather than a second file
 *  to keep in step. Throws below if icon.svg is restructured. */
const GLYPH_SCALE = /(<g id="glyph" transform="translate\(256 256\) scale\()([\d.]+)(\))/;

const targets = [
  { file: "favicon-32.png", size: 32, maskable: false },
  { file: "apple-touch-icon-180.png", size: 180, maskable: false },
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--no-proxy-server", "--proxy-bypass-list=*"],
});

try {
  for (const { file, size, maskable } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    let inner = svg;
    if (maskable) {
      if (!GLYPH_SCALE.test(svg)) throw new Error("icon.svg's glyph transform changed shape — update GLYPH_SCALE");
      inner = svg.replace(GLYPH_SCALE, (_m, head, scale, tail) => `${head}${(Number(scale) * MASKABLE_SCALE).toFixed(3)}${tail}`);
    }
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${inner}`
    );
    writeFileSync(resolve(publicDir, file), await page.screenshot({ omitBackground: false }));
    await page.close();
    console.log(`wrote ${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
