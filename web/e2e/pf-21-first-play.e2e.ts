import { expect, test } from '@playwright/test';
import { audioStates, resetMix, soundsStarted, spyOnAudio } from './helpers';

/**
 * PF-21: the sound device opens while Listen is idle, before the first Play, so the press only
 * resumes it. In each engine (Edge, Firefox, WebKit) the one context exists and is still suspended
 * before Play, then is running after the first press and the song starts. A browser that permits
 * autoplay starts a new context running; the player puts it back to sleep, so it is suspended here
 * too, and no source starts until Play. Run with playwright.pf21.config.ts.
 */

test.beforeEach(async ({ request }) => resetMix(request));

test('PF-21 first Play resumes the idle-made context to running and playback starts', async ({ page }) => {
  await spyOnAudio(page);
  await page.goto('/listen');
  const play = page.getByRole('button', { name: /^(Play|Resume)/ });
  await expect(play).toBeVisible();
  // made ahead of the press, and asleep until it (even where autoplay would let it run)
  await expect.poll(() => audioStates(page), { timeout: 10_000 }).toEqual(['suspended']);
  expect(await soundsStarted(page)).toBe(0);
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => audioStates(page)).toEqual(['running']);
  expect(await soundsStarted(page)).toBeGreaterThanOrEqual(1);
});
