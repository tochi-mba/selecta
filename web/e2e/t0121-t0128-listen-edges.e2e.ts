import { expect, Page, test } from '@playwright/test';
import { resetMix, rewriteJson, spyOnAudio, stickingOut } from './helpers';

/* Selecta 2.0 T0121 (ADR-0008) and T0128 (ADR-0009): Listen on a phone with reduced motion, with no
 * next song, very long and right-to-left names and a transition that fails; and the fullscreen Stage
 * when the route changes underneath it. */

const title = (page: Page) => page.locator('h1.display');
const pauseButton = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true });

async function play(page: Page) {
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(pauseButton(page)).toBeVisible();
}

let problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await spyOnAudio(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('T0121 with no next song, Listen says it is the last one and Next is not offered', async ({ page, request }) => {
  await resetMix(request, [1]);
  await page.goto('/listen');
  await expect(title(page)).toHaveText('Morning Light');
  await play(page);
  await expect(page.getByText('This is the last song in the mix.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next song' })).toBeDisabled();
  expect(await stickingOut(page, 'last song at 375px')).toEqual([]);
});

test('T0121 very long and right-to-left names wrap inside a phone screen', async ({ page, request }) => {
  await resetMix(request);
  const long = 'An Extraordinarily Long Song Title That Keeps Going Well Past Any Phone Width (Extended Remix)';
  const rtl = 'أغنية طويلة جدا عن ضوء الصباح';
  await page.route('**/api/mix', (route) => rewriteJson(route, (body) => {
    body.mix[0].title = long;
    body.mix[0].artist = 'Someone With A Remarkably Long Artist Name Featuring Several Other Artists';
    if (body.mix[1]) body.mix[1].title = rtl;
    return body;
  }));
  await page.goto('/listen');
  await expect(title(page)).toHaveText(long);
  expect(await stickingOut(page, 'long names at 375px')).toEqual([]);
  const box = (await title(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(376);
});

test('T0121 a failed transition on a phone with reduced motion still carries the music on', async ({ page, request }) => {
  await resetMix(request);
  // The next transition is reported as failed, and its audio can't be fetched either.
  await page.route('**/api/mix', (route) => rewriteJson(route, (body) => {
    if (body.mix[1]?.seam) body.mix[1].seam.state.status = 'failed';
    return body;
  }));
  await page.route('**/api/seams/*/clip', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.goto('/listen');
  await expect(title(page)).toHaveText('Morning Light');
  // reduced motion: the motion tokens collapse to nothing on this page
  const fast = await page.locator('html').evaluate((root) => getComputedStyle(root).getPropertyValue('--motion-fast').trim());
  expect(fast).toMatch(/^0(ms|s)?$/);
  await play(page);
  const strip = page.getByRole('slider', { name: 'Where in the song' });
  const area = (await strip.boundingBox())!;
  await strip.click({ position: { x: area.width * 0.94, y: area.height / 2 } });
  await expect(title(page)).toHaveText('Slow Tide', { timeout: 30_000 });
  await expect(pauseButton(page)).toBeVisible();
  expect(await stickingOut(page, 'after the failed transition at 375px')).toEqual([]);
});

test('T0128 changing route while the fullscreen Stage is open leaves it cleanly and keeps the music', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await resetMix(request);
  await page.goto('/library');
  // inside the app, so Back is the app's own route change rather than loading a new page
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Listen', exact: true }).click();
  await expect(title(page)).toHaveText('Morning Light');
  await play(page);
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.locator('.now.stage')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  // the mini-player carries on
  await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/listen/);
  await expect(title(page)).toHaveText('Morning Light');
  await expect(pauseButton(page)).toBeVisible();
  expect(await page.evaluate(() => window.audioSpy.contexts.length)).toBe(1);
  const states = await page.evaluate(() => window.audioSpy.contexts.map((context) => context.state));
  expect(states).toContain('running');
});
