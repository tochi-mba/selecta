import { expect, test } from '@playwright/test';
import { failNetwork, FIXED_NOW, fixClock } from './harness';
import { resetMix } from './helpers';

/** T0013: the harness's deterministic clock and network-failure injection, proven against the real app. */
test.beforeEach(async ({ request }) => resetMix(request));

test('the clock starts at a known moment and only moves when the spec moves it', async ({ page }) => {
  await fixClock(page);
  await page.goto('/listen');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.clock.pauseAt(new Date(FIXED_NOW.getTime() + 5_000));
  const start = await page.evaluate(() => Date.now());
  expect(start).toBe(FIXED_NOW.getTime() + 5_000);
  await page.clock.runFor(60_000);
  expect(await page.evaluate(() => Date.now())).toBe(start + 60_000);
});

test('a lost connection is noticed and recovered from on the fake clock, with no real waiting', async ({ page }) => {
  await fixClock(page);
  await page.goto('/mix/current/edit');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const restore = await failNetwork(page, 'offline');
  await expect(async () => {
    await page.clock.runFor(5_000);
    await expect(page.getByText('Can’t reach Selecta.')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 20_000 });
  await restore();
  await expect(async () => {
    await page.clock.runFor(5_000);
    await expect(page.getByText('Can’t reach Selecta.')).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 20_000 });
});

test('a server fault and a full disk reach the page as what they are', async ({ page }) => {
  await page.goto('/listen');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const restore = await failNetwork(page, 'storage', '**/api/harness-probe');
  const storage = await page.evaluate(async () => {
    const answer = await fetch('/api/harness-probe');
    return { status: answer.status, body: await answer.json() };
  });
  expect(storage).toEqual({ status: 507, body: { detail: 'There isn’t enough free space to save that.', code: 'storage_full' } });
  await restore();
  await failNetwork(page, 'server', '**/api/library**');
  await page.goto('/library');
  await expect(page.getByText(/Something went wrong inside Selecta/).first()).toBeVisible();
});
