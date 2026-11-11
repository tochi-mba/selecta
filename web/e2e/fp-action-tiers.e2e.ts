import { expect, Page, test } from '@playwright/test';
import { audioClock, resetMix, soundsRestarted, spyOnAudio } from './helpers';

/**
 * ADR-0269 (docs/engineering/action-tier-register.md), in a real browser:
 *   FP-0269-06  opening and closing the disclosures that hold contextual and advanced actions never changes
 *               the page, the current mix, the playing song, the audio or where focus was.
 *   FP-0269-07  at 320px and in a shallow landscape window, each surface's primary action is on screen
 *               (after scrolling to it), in Light and in Dark, and Tab carries focus past it.
 */

test.beforeEach(async ({ request }) => resetMix(request));

const mixSnapshot = (page: Page) => page.evaluate(async () => {
  const answer = await fetch('/api/mix').then((reply) => reply.json());
  const songs = (answer.mix ?? answer.songs ?? answer) as { song_id?: number }[];
  return JSON.stringify(Array.isArray(songs) ? songs.map((song) => song.song_id) : answer);
});

test('disclosures keep the route, mix, audio and focus as they were (FP-0269-06)', async ({ page }) => {
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
  const started = await soundsRestarted(page);
  const mix = await mixSnapshot(page);
  const title = await page.locator('.now h1, .now .display').first().innerText();

  // Listen: DJ controls (advanced) open and close
  const dj = page.locator('details.view-options > summary');
  const url = page.url();
  for (let pass = 0; pass < 2; pass += 1) {
    await dj.focus();
    await page.keyboard.press('Enter');
    await expect(dj).toBeFocused();
  }
  expect(page.url()).toBe(url);
  expect(await page.locator('.now h1, .now .display').first().innerText()).toBe(title);

  // Explore (in-app, so the player keeps going): a card's detail and the shaping dialog
  await page.getByRole('link', { name: /Make a Mix|Explore/ }).first().click();
  const summary = page.locator('article.vibe-card summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(summary).toBeFocused();
  await expect(page.locator('article.vibe-card details').first()).toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  const customize = page.getByRole('button', { name: 'Customize' });
  if (await customize.count()) {
    await customize.click();
    await expect(page.getByRole('dialog', { name: 'Shape the next mix' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(customize).toBeFocused();
  }

  // Library: a row's More menu opens and closes with focus coming back
  await page.getByRole('link', { name: 'Library' }).first().click();
  const more = page.getByRole('button', { name: /^More/ }).first();
  if (await more.count()) {
    await more.click();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
  }

  expect(await soundsRestarted(page), 'nothing restarted').toBe(started);
  const clock = (await audioClock(page))[0];
  await expect.poll(async () => (await audioClock(page))[0], { message: 'still playing' }).toBeGreaterThan(clock);
  expect(await mixSnapshot(page), 'current mix unchanged').toBe(mix);
});

const SURFACES: { path: string; primary: (page: Page) => ReturnType<Page['getByRole']> }[] = [
  { path: '/mixes', primary: (page) => page.locator('section.mix-quick').getByRole('button', { name: 'Play', exact: true }) },
  { path: '/mix/current/edit', primary: (page) => page.getByRole('button', { name: /Play from the top/ }) },
  { path: '/library', primary: (page) => page.getByRole('button', { name: 'Start a mix' }).first() },
  { path: '/mixes/mine', primary: (page) => page.getByRole('button', { name: 'Edit', exact: true }).first() },
];

for (const view of [{ width: 320, height: 568 }, { width: 667, height: 320 }]) {
  test(`primary actions stay reachable at ${view.width}x${view.height} in both themes (FP-0269-07)`, async ({ page }) => {
    await page.setViewportSize(view);
    for (const theme of ['light', 'dark'] as const) {
      await page.goto('/mixes');
      await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
      for (const surface of SURFACES) {
        await page.goto(surface.path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const primary = surface.primary(page);
        await expect(primary, `${theme} ${surface.path}`).toBeVisible();
        await primary.scrollIntoViewIfNeeded();
        await expect(primary).toBeInViewport();
        const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(width, `${theme} ${surface.path} scrolls sideways`).toBeLessThanOrEqual(1);
        // focus reaches it and moves on: no trap around the core action
        await primary.focus();
        await expect(primary).toBeFocused();
        await page.keyboard.press('Tab');
        expect(await primary.evaluate((node) => node === document.activeElement), `${theme} ${surface.path} traps focus`).toBe(false);
      }
    }
  });
}
