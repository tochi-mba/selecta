import { expect, test } from '@playwright/test';
import { allRendered, PAGES, resetMix } from './helpers';

/**
 * ADR-0072 (S3-0072-08): the first screen, every page, starting the mix and a transition preview all
 * stay on this computer. The only remote call Selecta makes on purpose (the LRCLIB lyric lookup) is
 * made by the local server during a folder scan, never by the page.
 */

test.beforeEach(async ({ request }) => resetMix(request));

test('first screen, navigation, playback and a preview make no request beyond this computer (S3-0072-08)', async ({ page, request }) => {
  const elsewhere: string[] = [];
  page.on('request', (sent) => {
    const url = new URL(sent.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) elsewhere.push(sent.url());
  });
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  for (const address of PAGES) {
    await page.goto(address);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  }

  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 20_000 });

  await allRendered(request);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Hear it' }).first().click();
  const preview = page.locator('audio.preview').first();
  await expect(preview).toBeVisible();
  await preview.evaluate((element: HTMLAudioElement) => element.play().catch(() => {}));
  await page.waitForTimeout(1000);
  await preview.evaluate((element: HTMLAudioElement) => element.pause());

  expect(elsewhere).toEqual([]);
});
