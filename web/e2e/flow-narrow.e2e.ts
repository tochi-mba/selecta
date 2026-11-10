import { expect, test } from '@playwright/test';
import { resetMix, shownTime, spyOnAudio } from './helpers';

// Flow SF-0203-06: at 320px the transition inspector and the persistent player are both reachable,
// and opening the inspector does nothing to the music.

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await spyOnAudio(page);
});

test('at 320px the inspector and the mini-player are both reachable while the music plays', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/listen');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();

  // move inside the app, as a link would, so the same player carries on
  await page.evaluate(() => {
    history.pushState({}, '', '/mix/current/edit');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const pause = page.getByRole('button', { name: 'Pause' }).first();
  await expect(pause).toBeVisible();
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  const tab = page.getByRole('tab', { name: 'Change' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await tab.scrollIntoViewIfNeeded();
  await expect(tab).toBeInViewport();
  await expect(page.locator('.inspector-pair')).toBeVisible();

  // nothing is wider than the window, and the player is still on screen and not covered
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(pause).toBeInViewport();
  const box = await pause.boundingBox();
  expect(box).not.toBeNull();
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '', { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  expect(top).toContain('Pause');
  expect(await page.evaluate(() => window.audioSpy.contexts.map((context) => context.state))).toEqual(['running']);
});

// Flow SF-0214-02: the seek strip is a large target that works by touch and by keyboard.
test('the seek strip takes a tap on a touch screen and arrow keys, at 320px', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await spyOnAudio(page);
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();
  const strip = page.getByRole('slider', { name: 'Where in the song' });
  await strip.scrollIntoViewIfNeeded();
  const box = (await strip.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(280);
  await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height / 2);
  await expect.poll(() => shownTime(page)).toBeGreaterThan(15);
  const tapped = await shownTime(page);
  expect(tapped).toBeLessThan(35);
  await strip.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => shownTime(page)).toBeGreaterThanOrEqual(tapped + 4);
  await context.close();
});
