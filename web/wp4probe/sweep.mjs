// WP4 scratch: DOM text sweep of every route for the UF-0388-05 copy audit. Deleted after use.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = 'http://127.0.0.1:9770';
const out = process.argv[2];
const routes = ['/listen', '/mixes', '/mixes/mine', '/mixes/lucy', '/mix/current/edit', '/library',
  '/discover', '/discover/harmonic', '/workshop', '/workshop/analysis', '/workshop/storage',
  '/workshop/learning', '/studies'];
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.emulateMedia({ reducedMotion: 'reduce' });
const result = { version: browser.version(), routes: {} };
for (const route of routes) {
  await page.goto(base + route, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  // open every closed disclosure so hidden-by-default copy is swept too
  for (const d of await page.locator('details:not([open]) > summary').all()) { await d.click({ timeout: 500 }).catch(() => {}); }
  await page.waitForTimeout(300);
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    const attrs = [];
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[aria-description]')) {
      for (const a of ['aria-label', 'title', 'placeholder', 'aria-description']) {
        const v = el.getAttribute(a); if (v) attrs.push(v);
      }
    }
    return { text, attrs, title: document.title };
  });
  result.routes[route] = data;
}
fs.writeFileSync(out, JSON.stringify(result, null, 1));
await browser.close();
