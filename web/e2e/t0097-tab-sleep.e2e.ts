import { expect, test } from '@playwright/test';
import { resetMix, spyOnAudio } from './helpers';

/* Selecta 2.0 T0097 (ADR-0028): the browser freezing a tab (as it does to save power) and waking it.
 * The page comes back working and reads fresh state again.
 * Server restarts mid-work are in tests/test_restart_mid_work.py. */

test('a frozen tab wakes up still working, with its mix, and reads fresh state again', async ({ page, request }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await spyOnAudio(page);
  await resetMix(request, [1, 2, 3]);
  await page.goto('/listen');
  await expect(page.locator('h1.display')).toHaveText('Morning Light');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  let reads = 0;
  page.on('request', (sent) => { if (/\/api\/(status|mix)(\?|$)/.test(sent.url())) reads += 1; });
  // A browser only freezes a tab that is in the background, so another tab comes to the front first.
  const other = await page.context().newPage();
  await other.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  reads = 0;
  // While frozen, the server changes underneath it.
  await request.post('/api/mix/songs', { data: { song_id: 4 } });
  await page.waitForTimeout(3000);
  expect(reads).toBe(0);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await page.bringToFront();
  await other.close();

  await expect.poll(() => reads, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page.locator('h1.display')).toHaveText('Morning Light');
  // Either still playing, or honestly paused with a way to carry on: never a dead control.
  await expect(page.getByRole('button', { name: /^(Pause|Play|Resume)/ }).first()).toBeEnabled();
  expect(problems).toEqual([]);
});
