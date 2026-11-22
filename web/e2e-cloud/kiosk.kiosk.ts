import { expect, test } from '@playwright/test';
import { ALICE, audible, makeOrg, managerPairs, pairedKiosk, shownCode } from './kioskHelpers';

// ADR-0445 kiosk player, against the kiosk e2e server (playwright.kiosk.config.ts, controls in
// tests/e2e_cloud_kiosk.py): the real /kiosk page, the real kiosk routes and signed heartbeats,
// the real player playing the zone's uploaded songs. The manager's pairing step is the manager
// route the venue Devices tab calls (POST /api/kiosk/pair), sent with Alice's sign-in.

test.describe('pairing (BZ-0445-02)', () => {
  test('test_kiosk_pairs_from_a_code_typed_by_a_manager', async ({ page, baseURL }) => {
    const org = await makeOrg(page.request);
    await page.goto('/kiosk');
    await expect(page.getByRole('heading', { name: 'Pair this player' })).toBeVisible();
    const code = await shownCode(page);

    const wrong = await managerPairs(page.request, baseURL!, org, 'AAAAAA');
    expect(wrong.status()).toBe(404);
    const right = await managerPairs(page.request, baseURL!, org, code);
    expect(right.status()).toBe(201);
    expect((await right.json()).role).toBe('home');

    // the player notices by itself, signs its first heartbeat and shows the zone
    await expect(page.locator('[data-screen="playing"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Kiosk song 1')).toBeVisible();
    await audible(page);

    // the code worked once
    expect((await managerPairs(page.request, baseURL!, org, code)).status()).toBe(404);
    const listed = await page.request.get('/api/business/kiosks', { headers: { Authorization: ALICE, 'X-Workspace-ID': org.org } });
    expect((await listed.json()).kiosks).toHaveLength(1);
  });
});

test.describe('restart (BZ-0445-06)', () => {
  test('test_power_cut_restart_resumes_without_a_tap_when_flags_allow', async ({ page, baseURL }) => {
    const org = await makeOrg(page.request);
    await pairedKiosk(page, baseURL!, org);
    await audible(page);
    // a power cut: the page starts again from nothing but its cookie and saved storage
    await page.reload();
    await expect(page.getByRole('button', { name: 'Tap to start the music' })).toHaveCount(0);
    await audible(page);
    await expect(page.locator('[data-screen="playing"]')).toBeVisible();
  });

  test('a restart while closed shows Closed and plays nothing', async ({ page, baseURL }) => {
    const org = await makeOrg(page.request);
    await pairedKiosk(page, baseURL!, org);
    await audible(page);
    expect((await page.request.post('/test/kiosk/hours', { data: { org: org.org, venue: org.venue, open: false } })).ok()).toBe(true);
    await page.reload();
    await expect(page.locator('[data-screen="closed"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('data-audible', 'no');
  });
});

test.describe('updates (BZ-0445-08)', () => {
  test('test_auto_update_waits_for_closed_hours', async ({ page, baseURL }) => {
    const org = await makeOrg(page.request);
    await pairedKiosk(page, baseURL!, org);
    await audible(page);
    await page.evaluate(() => { (window as unknown as { __before?: number }).__before = 1; });
    expect((await page.request.post('/test/kiosk/release', { data: { version: '2099.1.1' } })).ok()).toBe(true);

    // open: the new version is fetched in the background but never applied during service
    await page.waitForTimeout(20_000);
    expect(await page.evaluate(() => (window as unknown as { __before?: number }).__before)).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-audible', 'yes');

    // closed: it applies (one reload) and comes back
    expect((await page.request.post('/test/kiosk/hours', { data: { org: org.org, venue: org.venue, open: false } })).ok()).toBe(true);
    await page.waitForFunction(() => (window as unknown as { __before?: number }).__before === undefined, null, { timeout: 90_000 });
    await expect(page.locator('[data-screen="closed"]')).toBeVisible({ timeout: 30_000 });
  });
});
