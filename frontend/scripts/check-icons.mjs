/**
 * Checks the app's icon files, because the way icons go wrong is quietly.
 *
 * The bug this exists to catch already happened: the full logo lockup —
 * house, sprig *and* the word "youenjoymyfamily" — was serving as the
 * favicon, the iOS home-screen icon and the PWA maskable icon all at once.
 * Nothing failed. It was simply illegible everywhere it appeared, which you
 * only discover by installing the app on a phone and squinting at it.
 *
 * It is worth being exact about *why*, because the obvious guess is wrong.
 * The lockup was not being cropped: its ink reaches 146 pixels from the
 * centre of a 512 square, comfortably inside the 205-pixel circle a maskable
 * icon is promised. The problem is that the drawing is tiny inside all that
 * cream — 1.6% of the square is ink, and the wordmark is about six pixels
 * tall once a launcher has scaled 512 down to a home screen. So the rule
 * with teeth is density, not extent.
 *
 * Both are checked anyway, because extent is the rule that bites the *next*
 * mistake: the drawing is deliberately large now, and growing it a little
 * further would push it out of the safe circle.
 *
 * This is a script rather than a Vitest test for the same reason
 * check-bundle-has-no-key.mjs is: it reads built files off disk, and doing
 * that from `src` would mean adding @types/node to the frontend, which would
 * put `process` and `Buffer` in scope for every component in the app. A
 * browser bundle that cannot see Node's globals is worth more than the
 * convenience.
 *
 * Run by `npm run verify:icons`, and in CI. Re-run `npm run icons` first if
 * you have edited public/icon.svg.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const PUBLIC = new URL("../public/", import.meta.url);
const read = (file) => readFileSync(new URL(file.replace(/^\//, ""), PUBLIC));

/**
 * The smallest PNG reader that answers the question asked here.
 *
 * Deliberately not a dependency: these files are 8-bit truecolour and
 * non-interlaced — that is what `npm run icons` writes, and the header check
 * refuses anything else — which is a few lines of zlib plus the five
 * scanline filters from the spec.
 */
function decodePng(buffer, name) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((byte, i) => buffer[i] !== byte)) fail(`${name} is not a PNG.`);

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const [depth, colour, , , interlace] = [body.readUInt8(8), body.readUInt8(9), 0, 0, body.readUInt8(12)];
      if (depth !== 8 || colour !== 2 || interlace !== 0) {
        fail(`${name} is not 8-bit non-interlaced truecolour (depth ${depth}, colour type ${colour}, interlace ${interlace}).`);
      }
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4) };
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length; // length + type + body + CRC
  }

  if (!header) fail(`${name} has no IHDR chunk.`);
  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const pixels = new Uint8Array(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 3 ? pixels[y * stride + x - 3] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= 3 && y > 0 ? pixels[(y - 1) * stride + x - 3] : 0;
      let value;
      switch (filter) {
        case 0: value = line[x]; break;
        case 1: value = line[x] + a; break;
        case 2: value = line[x] + b; break;
        case 3: value = line[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
          value = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: fail(`${name} uses unknown PNG filter ${filter}.`);
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, pixels };
}

/** The cream the icons are drawn on, sampled from the original lockup. */
const BACKGROUND = [0xf7, 0xea, 0xd3];

/**
 * How far a pixel strays from the background before it counts as drawing.
 * Anti-aliased edges shade off gradually, so ink needs a threshold rather
 * than an equality check; 24 is well above the couple of units of noise in a
 * flat fill and well below any of the three drawing colours.
 */
const INK_THRESHOLD = 24;

const isInk = ({ width, pixels }, x, y) => {
  const i = (y * width + x) * 3;
  return (
    Math.abs(pixels[i] - BACKGROUND[0]) +
      Math.abs(pixels[i + 1] - BACKGROUND[1]) +
      Math.abs(pixels[i + 2] - BACKGROUND[2]) >
    INK_THRESHOLD
  );
};

/** Android promises only the middle 80% of a maskable icon. */
const SAFE_RADIUS_SHARE = 0.4;

/**
 * Share of pixels that are ink, and how far the furthest inked pixel sits
 * from the centre. `region` narrows the *density* question to the safe
 * circle for a maskable icon, because the safe circle is the only part of
 * one a launcher promises to show.
 *
 * `furthest` deliberately ignores `region` and scans the whole square. It
 * asks the opposite question — is any ink *outside* the circle — and an
 * earlier version of this that skipped those pixels could never answer yes.
 * It passed a glyph drawn half again too big; the mutation that grew the
 * drawing is what caught it.
 */
function measure(bitmap, region) {
  const centre = bitmap.width / 2;
  const safeRadius = bitmap.width * SAFE_RADIUS_SHARE;
  let considered = 0;
  let inked = 0;
  let furthest = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const ink = isInk(bitmap, x, y);
      if (ink) furthest = Math.max(furthest, distance);
      if (region === "safe-circle" && distance > safeRadius) continue;
      considered += 1;
      if (ink) inked += 1;
    }
  }

  return { inkShare: inked / considered, furthest, safeRadius };
}

/**
 * The floor for how much of its square a drawing has to occupy, not a
 * target: the current mark sits around 11% on the manifest icons and 14%
 * inside the maskable safe circle, while the old lockup managed 1.6% and
 * 3.2%. Anything down at that end is a logo doing an icon's job.
 */
const MIN_INK_SHARE = 0.08;
/** A tab icon is the tightest case — roughly 16 CSS pixels — so it asks more. */
const MIN_FAVICON_INK_SHARE = 0.1;

const problems = [];
const note = (message) => problems.push(message);
function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// --- the manifest ----------------------------------------------------------
const manifest = JSON.parse(read("manifest.webmanifest").toString("utf8"));
const purposes = manifest.icons.map((icon) => icon.purpose);

for (const required of ["any", "maskable"]) {
  if (!purposes.includes(required)) note(`manifest.webmanifest declares no icon with purpose "${required}".`);
}

for (const icon of manifest.icons) {
  const bitmap = decodePng(read(icon.src), icon.src);
  const actual = `${bitmap.width}x${bitmap.height}`;
  if (actual !== icon.sizes) note(`${icon.src} is declared ${icon.sizes} in the manifest but is really ${actual}.`);

  const maskable = icon.purpose === "maskable";
  const { inkShare, furthest, safeRadius } = measure(bitmap, maskable ? "safe-circle" : "square");

  if (inkShare <= MIN_INK_SHARE) {
    note(
      `${icon.src} is ${(inkShare * 100).toFixed(1)}% drawing and the rest margin` +
        `${maskable ? " inside its safe circle" : ""} — under the ${(MIN_INK_SHARE * 100).toFixed(0)}% floor. ` +
        "It will not read once a launcher scales it down."
    );
  }
  if (maskable && furthest > safeRadius) {
    note(
      `${icon.src} draws ${furthest.toFixed(0)}px from its centre, outside the ${safeRadius}px circle Android ` +
        "guarantees. Some launchers will crop that off — lower MASKABLE_SCALE in scripts/render-icons.mjs."
    );
  }
}

// --- index.html ------------------------------------------------------------
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const iconLinks = indexHtml.match(/<link[^>]*rel="(?:icon|apple-touch-icon|manifest)"[^>]*>/g) ?? [];
if (!iconLinks.length) note("index.html declares no icon or manifest links at all.");

for (const link of iconLinks) {
  const href = /href="([^"]+)"/.exec(link)?.[1];
  if (!href) {
    note(`index.html has an icon link with no href: ${link}`);
    continue;
  }
  try {
    read(href);
  } catch {
    note(`index.html points at ${href}, which is not in public/.`);
  }
  if (href.includes("brand-mark") && !link.includes('rel="manifest"')) {
    note(`index.html uses the full lockup as an icon (${link.trim()}) — the wordmark is unreadable at icon size.`);
  }
}

// --- the favicon -----------------------------------------------------------
const favicon = measure(decodePng(read("favicon-32.png"), "favicon-32.png"), "square");
if (favicon.inkShare <= MIN_FAVICON_INK_SHARE) {
  note(
    `favicon-32.png is ${(favicon.inkShare * 100).toFixed(1)}% drawing — under the ` +
      `${(MIN_FAVICON_INK_SHARE * 100).toFixed(0)}% a 16px tab icon needs to be anything but a smudge.`
  );
}

if (problems.length) {
  console.error(`\n${problems.map((p) => `  ✗ ${p}`).join("\n\n")}\n`);
  process.exit(1);
}
console.log("\n✓ Icons are the right sizes, dense enough to read, and inside the maskable safe zone.\n");
