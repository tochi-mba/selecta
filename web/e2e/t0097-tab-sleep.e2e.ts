import { expect, test } from '@playwright/test';
import { resetMix, spyOnAudio } from './helpers';

/* Selecta 2.0 T0097 (ADR-0028): the browser freezing a tab (as it does to save power) and waking it.
 * The page comes back working and reads fresh state again.
 * Server restarts mid-work are in tests/test_restart_mid_work.py. */

test('a frozen tab wakes up still working, with its mix, and reads fresh state again', async ({ page, request }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await spyOnAudio(page);
  await page.addInitScript(() => {
    const flag = window as unknown as { pretendHidden: boolean };
    flag.pretendHidden = false;
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (flag.pretendHidden ? 'hidden' : 'visible') });
    Object.defineProperty(Document.prototype, 'hidden', { get: () => flag.pretendHidden });
  });
  await resetMix(request, [1, 2, 3]);
  await page.goto('/listen');
  await expect(page.locator('h1.display')).toHaveText('Morning Light');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  let reads = 0;
  page.on('request', (sent) => { if (/\/api\/(status|mix)(\?|$)/.test(sent.url())) reads += 1; });
  // Headless browsers never background a tab, so the page is told it is hidden the way a browser
  // tells it (visibilityState and visibilitychange), and then frozen.
  const setHidden = (hidden: boolean) => page.evaluate((value) => {
    (window as unknown as { pretendHidden: boolean }).pretendHidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await setHidden(true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  reads = 0;
  // While asleep, the server changes underneath it.
  await request.post('/api/mix/songs', { data: { song_id: 4 } });
  await page.waitForTimeout(4000);
  expect(reads).toBe(0);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await setHidden(false);

  await expect.poll(() => reads, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page.locator('h1.display')).toHaveText('Morning Light');
  // Either still playing, or honestly paused with a way to carry on: never a dead control.
  await expect(page.getByRole('button', { name: /^(Pause|Play|Resume)/ }).first()).toBeEnabled();
  expect(problems).toEqual([]);
});
