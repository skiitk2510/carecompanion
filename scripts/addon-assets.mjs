#!/usr/bin/env node
// Renders the Alexa+ add-on store media in addon-package/media with the local Chrome: the listing icon at every size
// the manifest needs (light and dark) and the 600x900 carousel card composited from the README's duplicate-dose figure.
// Then reads every PNG's IHDR back, asserts the exact dimensions, and checks that addon.json points at these files.
// Usage: node scripts/addon-assets.mjs   (env: CHROME — Chrome/Chromium binary; defaults to the macOS install)
/* global document */ // the evaluate() callback below runs inside the browser page
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PACKAGE = join(ROOT, 'addon-package');
const OUT = join(PACKAGE, 'media');
const FIGURE = join(ROOT, 'docs', 'figures', 'web-app-guard.png');
const ICON_SIZES = [64, 72, 88, 126, 180, 241];
const ICON_SOURCES = { light: 'icon.svg', dark: 'icon-dark.svg' };
const CAROUSEL = { name: 'carousel-1-600x900.png', width: 600, height: 900 };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height straight from the PNG header: 8-byte signature, then the IHDR chunk (length, "IHDR", width, height). */
function pngSize(bytes, label) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(`${label}: not a PNG`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const iconName = (variant, size) => `icon-${variant}-${size}x${size}.png`;

/** The SVG alone on a transparent page; CSS sizes the root element so one source renders at every listing size. */
const iconHtml = (svg, size) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;

/**
 * The 600x900 carousel card: title band, the whole figure scaled to fit, a legible crop of the device panel with the
 * guard's refusal, a caption and feature chips. The crop is expressed as fractions of the figure so a re-captured
 * figure (npm run figures, same 1280x800 layout) drops in unchanged.
 */
function carouselHtml({ iconSvg, figureDataUri, figure }) {
  const frame = { width: 536, height: 262 };
  const crop = { x: 46 / 2560, y: 276 / 1600, width: 1073 / 2560 };
  const scale = frame.width / (crop.width * figure.width);
  const img = {
    width: Math.round(figure.width * scale),
    left: -Math.round(crop.x * figure.width * scale),
    top: -Math.round(crop.y * figure.height * scale),
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${CAROUSEL.width}px; height: ${CAROUSEL.height}px; overflow: hidden; }
  body {
    box-sizing: border-box; padding: 28px 32px 26px; display: flex; flex-direction: column; gap: 14px;
    background: radial-gradient(120% 70% at 0% 0%, rgba(62, 192, 177, 0.28), transparent 60%),
      linear-gradient(160deg, #0f1c31 0%, #0b1220 100%);
    color: #fff; -webkit-font-smoothing: antialiased;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }
  .head { display: flex; align-items: center; gap: 16px; }
  .head svg { flex: none; width: 60px; height: 60px; filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35)); }
  .title { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .subtitle { margin-top: 5px; font-size: 16px; color: rgba(255, 255, 255, 0.78); white-space: nowrap; }
  .shot {
    flex: none; width: ${frame.width}px; overflow: hidden; border-radius: 12px; background: #101726;
    border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
  }
  .shot.full img { display: block; width: ${frame.width}px; height: auto; }
  .shot.detail { position: relative; height: ${frame.height}px; }
  .shot.detail img { position: absolute; width: ${img.width}px; left: ${img.left}px; top: ${img.top}px; }
  .caption { font-size: 15px; line-height: 1.4; color: rgba(255, 255, 255, 0.86); }
  .caption b { color: #7fe0d3; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
  .chip {
    font-size: 13px; padding: 6px 11px; border-radius: 999px; color: rgba(255, 255, 255, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.06);
  }
</style></head><body>
  <div class="head">${iconSvg}<div><div class="title">CareCompanion</div><div class="subtitle">Medication safety guardrails for Alexa+</div></div></div>
  <div class="shot full"><img src="${figureDataUri}" alt=""></div>
  <div class="shot detail"><img src="${figureDataUri}" alt=""></div>
  <div class="caption"><b>Duplicate-dose guard.</b> A second Lisinopril is refused until the elder confirms explicitly and gives a reason — and the family is told.</div>
  <div class="chips"><span class="chip">Interaction &amp; allergy warnings</span><span class="chip">Symptom escalation to family</span><span class="chip">Family dashboard as an MCP App</span><span class="chip">Synthetic demo household · MIT</span></div>
</body></html>`;
}

async function render() {
  await mkdir(OUT, { recursive: true });
  const figureBytes = await readFile(FIGURE);
  const figure = pngSize(figureBytes, basename(FIGURE));
  const svgs = {};
  for (const [variant, file] of Object.entries(ICON_SOURCES)) {
    svgs[variant] = await readFile(join(PACKAGE, 'source', file), 'utf8');
  }

  const written = [];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    for (const [variant, svg] of Object.entries(svgs)) {
      for (const size of ICON_SIZES) {
        await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
        await page.setContent(iconHtml(svg, size), { waitUntil: 'load' });
        const png = await page.screenshot({
          type: 'png',
          omitBackground: true,
          clip: { x: 0, y: 0, width: size, height: size },
        });
        const name = iconName(variant, size);
        await writeFile(join(OUT, name), png);
        written.push({ name, width: size, height: size });
      }
    }

    await page.setViewport({ width: CAROUSEL.width, height: CAROUSEL.height, deviceScaleFactor: 1 });
    const figureDataUri = `data:image/png;base64,${figureBytes.toString('base64')}`;
    await page.setContent(carouselHtml({ iconSvg: svgs.light, figureDataUri, figure }), { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: CAROUSEL.width, height: CAROUSEL.height },
    });
    await writeFile(join(OUT, CAROUSEL.name), png);
    written.push({ name: CAROUSEL.name, width: CAROUSEL.width, height: CAROUSEL.height });
  } finally {
    await browser.close();
  }
  return written;
}

/** Reads every file back and checks the header; then checks that addon.json references exactly these files and sizes. */
async function verify(written) {
  let failures = 0;
  const report = (ok, line) => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
  };

  for (const expected of written) {
    const bytes = await readFile(join(OUT, expected.name));
    const actual = pngSize(bytes, expected.name);
    const ok = actual.width === expected.width && actual.height === expected.height;
    report(ok, `${expected.name.padEnd(26)} ${actual.width}x${actual.height}  (${bytes.length} bytes)`);
  }

  const manifest = JSON.parse(await readFile(join(PACKAGE, 'addon.json'), 'utf8'));
  const referenced = [];
  for (const locale of Object.values(manifest.storeListing.locales)) {
    const media = locale.mediaAssets;
    for (const list of [...Object.values(media.icons), media.carouselImages, media.bannerImages]) {
      referenced.push(...list);
    }
  }
  for (const { uri, size } of referenced) {
    const name = basename(new URL(uri).pathname);
    const file = written.find((w) => w.name === name);
    report(Boolean(file) && `${file?.width}x${file?.height}` === size, `addon.json → ${name} declared ${size}`);
  }
  const unreferenced = written.filter((w) => !referenced.some(({ uri }) => basename(new URL(uri).pathname) === w.name));
  report(
    unreferenced.length === 0,
    `every rendered file is referenced by addon.json (${referenced.length} references)`
  );

  if (failures > 0) throw new Error(`${failures} check(s) failed`);
  console.log(`\n${written.length} files verified in ${OUT}`);
}

try {
  await verify(await render());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
