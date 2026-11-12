import { expect, test } from '@playwright/test';
import { audioStates, resetMix, soundsStarted, spyOnAudio } from './helpers';

/**
 * PF-21: the sound device opens while Listen is idle, before the first Play, so the press only
 * resumes it. In each engine (Edge, Firefox, WebKit) the one context exists and is still suspended
 * before Play, then reaches 'running' on the first press and the song starts. Run across engines with
 * playwright.pf21.config.ts.
 */

test.beforeEach(async ({ request }) => resetMix(request));

test('PF-21 first Play resumes the idle-made context to running and playback starts', async ({ page }) => {
  await spyOnAudio(page);
  await page.goto('/listen');
  const play = page.getByRole('button', { name: /^(Play|Resume)/ });
  await expect(play).toBeVisible();
  // made ahead of the press, outside any gesture, so the browser leaves it suspended
  await expect.poll(() => audioStates(page), { timeout: 10_000 }).toEqual(['suspended']);
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await audioStates(page)).toEqual(['running']);
  expect(await soundsStarted(page)).toBeGreaterThanOrEqual(1);
});
