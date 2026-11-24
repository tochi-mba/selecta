// Renders the brand kit's PNGs from its SVG sources (web/public/brand/BRAND.md says which file goes
// where). Uses the Chromium Playwright already installs for the browser tests, so nothing new is
// downloaded. Run from web/: `node scripts/brand-kit.mjs`. The output is committed; run this again
// whenever an SVG changes.
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, '..', 'public', 'brand');
const icons = join(here, '..', 'public', 'icons');

/** [source svg, output png, width, height, where it goes] */
const EXPORTS = [
  ['mark.svg', 'brand/png/favicon-16.png', 16, 16, 'browser tab'],
  ['mark.svg', 'brand/png/favicon-32.png', 32, 32, 'browser tab, WorkOS favicon'],
  ['mark.svg', 'brand/png/favicon-64.png', 64, 64, 'WorkOS favicon (min 32)'],
  ['mark.svg', 'brand/png/apple-touch-icon-180.png', 180, 180, 'iPhone home screen'],
  ['mark.svg', 'icons/selecta-192.png', 192, 192, 'installable app'],
  ['mark.svg', 'icons/selecta-512.png', 512, 512, 'installable app'],
  ['mark.svg', 'brand/png/stripe-icon-512.png', 512, 512, 'Stripe Branding: Icon (square, min 128, under 512 KB)'],
  ['wordmark-light.svg', 'brand/png/stripe-logo-1280x320.png', 1280, 320, 'Stripe Branding: Logo (non-square)'],
  ['wordmark-light.svg', 'brand/png/workos-logo-light-1280x320.png', 1280, 320, 'WorkOS Branding: Logo (light)'],
  ['wordmark-dark.svg', 'brand/png/workos-logo-dark-1280x320.png', 1280, 320, 'WorkOS Branding: Logo (dark)'],
  ['mark.svg', 'brand/png/workos-logo-icon-512.png', 512, 512, 'WorkOS Branding: Logo icon (min 160, 1:1)'],
  ['mark.svg', 'brand/png/google-consent-120.png', 120, 120, 'Google OAuth branding: logo (120x120, under 1 MB)'],
  ['mark.svg', 'brand/png/email-logo-96.png', 96, 96, 'our own emails'],
  ['social-card.svg', 'brand/png/social-card-1200x630.png', 1200, 630, 'link previews (Open Graph, Twitter)'],
  ['room-card.svg', 'brand/png/room-card-1200x630.png', 1200, 630, 'link preview of a room link'],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [source, out, width, height] of EXPORTS) {
    const svg = await readFile(join(brand, source), 'utf8');
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${width}" height="${height}" `)}</body></html>`);
    const target = out.startsWith('icons/') ? join(icons, out.slice('icons/'.length)) : join(brand, out.slice('brand/'.length));
    await mkdir(dirname(target), { recursive: true });
    await page.screenshot({ path: target, omitBackground: true, clip: { x: 0, y: 0, width, height } });
    console.log(`${out} ${width}x${height}`);
  }
} finally {
  await browser.close();
}
