import { test } from '@playwright/test';
import { ROUTES, save, setTheme, settle } from './lib';

test('desktop action names and songs per route, for comparison with the phones', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setTheme(page, 'dark');
  const report: Record<string, unknown> = {};
  for (const route of ROUTES) {
    await page.goto(route.path);
    await settle(page);
    report[route.path] = await page.locator('main#main').evaluate((main) => {
      const actions = [...main.querySelectorAll('button, a[href], input, select, [role="tab"]')]
        .map((n) => (n.getAttribute('aria-label') ?? (n as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' '))
        .filter((n) => n && !/^\d+(:\d+)?$/.test(n));
      const songs = [...main.querySelectorAll('[class*="title"], .song-title, .track-title')].map((n) => (n as HTMLElement).innerText.trim()).filter(Boolean);
      return { actions: [...new Set(actions)].sort(), songs: [...new Set(songs)].sort() };
    });
  }
  save('parity-desktop.json', report);
});
