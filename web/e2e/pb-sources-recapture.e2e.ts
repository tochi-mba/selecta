import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// scratch (pb-): re-captures the committed Sources screenshots with the neutral test library path.
// Deleted after use.
const OUT = path.resolve('..', 'docs', 'verification', 'claude-checks');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const PIXEL_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.8127.18 Mobile Safari/537.36';

async function sources(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto('/workshop/sources');
  await expect(page.locator('.folder-list b').first()).toBeVisible();
  const shown = await page.locator('.folder-list b').first().textContent();
  expect(shown).toContain('selecta-e2e');
  expect(shown!.toLowerCase()).not.toContain('\\users\\');
  await page.evaluate(() => document.fonts.ready);
}

async function shot(browser: Browser, file: string, options: Parameters<Browser['newContext']>[0], scheme: 'light' | 'dark', css = false) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await sources(page, scheme);
  const buffer = await page.screenshot({ fullPage: true, scale: css ? 'css' : 'device' });
  fs.writeFileSync(path.join(OUT, file), buffer);
  await context.close();
  return buffer;
}

test('re-capture Sources screenshots', async ({ browser }) => {
  for (const width of [320, 768, 1440]) {
    for (const scheme of ['light', 'dark'] as const) {
      await shot(browser, `selecta-3-1/visual/${width}-${scheme}-sources.png`, { viewport: { width, height: 900 } }, scheme);
    }
  }
  await shot(browser, 'selecta-3-1/devices/iphone-size-edge-light-sources.png', { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }, 'light');
  await shot(browser, 'selecta-3-1/devices/iphone-size-edge-landscape-light-sources.png', { viewport: { width: 750, height: 342 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA }, 'light');
  await shot(browser, 'selecta-3-1/devices/pixel-edge-light-sources.png', { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: PIXEL_UA }, 'light');
  await shot(browser, 'selecta-3-1/devices/zoom200-edge-light-sources.png', { viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 }, 'light');
  await shot(browser, 'unified-finish/pixel7-portrait-sources.png', { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: PIXEL_UA }, 'light', true);
  await shot(browser, 'flows/local-8-discover-workshop/05-workshop-sources.png', { viewport: { width: 1280, height: 800 } }, 'light');
  // the paired light/dark sheet: both themes side by side, as the other pair-visual-* files
  const light = await shot(browser, 'pb-tmp-light.png', { viewport: { width: 1440, height: 900 } }, 'light');
  const dark = await shot(browser, 'pb-tmp-dark.png', { viewport: { width: 1440, height: 900 } }, 'dark');
  fs.rmSync(path.join(OUT, 'pb-tmp-light.png'));
  fs.rmSync(path.join(OUT, 'pb-tmp-dark.png'));
  const context = await browser.newContext({ viewport: { width: 1400, height: 435 } });
  const page = await context.newPage();
  const img = (data: Buffer) => `<img src="data:image/png;base64,${data.toString('base64')}" style="width:696px;height:435px;object-fit:cover;object-position:top">`;
  await page.setContent(`<body style="margin:0;background:#888;display:flex;gap:8px">${img(light)}${img(dark)}</body>`);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  fs.writeFileSync(path.join(OUT, 'unified-finish/pair-visual-1440-sources.png'), await page.screenshot());
  await context.close();
});
