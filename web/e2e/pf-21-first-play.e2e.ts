import { expect, test } from '@playwright/test';
import { audioStates, resetMix, soundsStarted, spyOnAudio } from './helpers';

/**
 * PF-21: the sound device opens while Listen is idle, before the first Play, so the press only
 * resumes it. In each engine (Edge, Firefox, WebKit) the one context exists and is still suspended
 * before Play, then is running after the first press and the song starts. Browsers that permit
 * autoplay can start the silent context earlier; no source may start until Play. Run with
 * playwright.pf21.config.ts.
 */

test.beforeEach(async ({ request }) => resetMix(request));

test('PF-21 first Play resumes the idle-made context to running and playback starts', async ({ page }) => {
  await spyOnAudio(page);
  await page.goto('/listen');
  const play = page.getByRole('button', { name: /^(Play|Resume)/ });
  await expect(play).toBeVisible();
  // The context exists before the first press. Edge can leave it running when autoplay is
  // allowed, but that must never start actual music before the listener presses Play.
  await expect.poll(() => audioStates(page), { timeout: 10_000 }).toHaveLength(1);
  expect(['suspended', 'running']).toContain((await audioStates(page))[0]);
  expect(await soundsStarted(page)).toBe(0);
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => audioStates(page)).toEqual(['running']);
  expect(await soundsStarted(page)).toBeGreaterThanOrEqual(1);
});
