import { expect, test } from '@playwright/test';
import { listener, signedIn } from './cloud';
import { audible, makeOrg, shownCode } from './kioskHelpers';

// ADR-0454 UI test "silent zone alert appears within 70 seconds and clears" (BZ-0454-05), on the
// kiosk e2e server (playwright.kiosk.config.ts): a real paired kiosk plays; the test server's
// `/test/kiosk/silence` control makes the alert pass read it as digital silence, and
// `/test/kiosk/sweep` runs that pass (as the maintenance loop does every 30 s), here 65 s after
// the silence began. The manager's HQ page polls every 10 s, so the alert shows within
// 60 s + 10 s of the silence starting, and clears once sound is back.

test('silent zone alert appears within 70 seconds and clears', async ({ page, browser, baseURL, request }) => {
  const name = listener('silent-owner');
  const manager = await (await browser.newContext({ baseURL })).newPage();
  await signedIn(manager, request, name);
  const org = await makeOrg(page.request, true, { user: name });
  await page.goto('/kiosk');
  const code = await shownCode(page);
  const paired = await page.request.post('/api/kiosk/pair', {
    headers: { Authorization: `Bearer e2e:${name}`, 'X-Workspace-ID': org.org, Origin: baseURL! },
    data: { code, zone_id: org.zone, name: 'Bar player' },
  });
  expect(paired.status(), await paired.text()).toBe(201);
  await audible(page);

  await manager.goto(`/b/${org.org}`);
  await expect(manager.getByText('High Street').first()).toBeVisible();
  await expect(manager.locator('.biz-silent')).toHaveCount(0);

  const silence = async (silent: boolean) => expect((await page.request.post('/test/kiosk/silence', { data: { zone: org.zone, silent } })).ok()).toBe(true);
  const sweep = async (advance: number) => expect((await page.request.post('/test/kiosk/sweep', { data: { advance_s: advance } })).ok()).toBe(true);

  await silence(true);
  await sweep(0); // the silence is noticed: pending, nobody told yet
  await sweep(30);
  await expect(manager.locator('.biz-silent')).toHaveCount(0); // under 60 s: no alert yet
  await sweep(65); // past 60 s of silence: the alert opens
  await expect(manager.locator('.biz-silent')).toBeVisible({ timeout: 10_000 + 2_000 });
  await expect(manager.locator('.biz-silent')).toContainText('Bar');

  await silence(false);
  await sweep(70); // sound is back: the alert closes
  await expect(manager.locator('.biz-silent')).toHaveCount(0, { timeout: 12_000 });
});
