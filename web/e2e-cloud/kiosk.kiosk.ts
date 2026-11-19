import { APIRequestContext, expect, Page, test } from '@playwright/test';

// ADR-0445 kiosk player, against the kiosk e2e server (playwright.kiosk.config.ts, controls in
// tests/e2e_cloud_kiosk.py): the real /kiosk page, the real kiosk routes and signed heartbeats,
// the real player playing the zone's uploaded songs. The manager's pairing step is the manager
// route the venue Devices tab calls (POST /api/kiosk/pair), sent with Alice's sign-in.

type Org = { org: string; venue: string; zone: string };
const ALICE = 'Bearer alice';

async function makeOrg(request: APIRequestContext, open = true): Promise<Org> {
  const made = await request.post('/test/kiosk/org', { data: { user: 'alice', songs: 3, open } });
  expect(made.ok()).toBe(true);
  return made.json();
}

async function managerPairs(request: APIRequestContext, baseURL: string, org: Org, code: string) {
  return request.post('/api/kiosk/pair', {
    headers: { Authorization: ALICE, 'X-Workspace-ID': org.org, Origin: baseURL },
    data: { code, zone_id: org.zone, name: 'Bar player' },
  });
}

async function shownCode(kiosk: Page): Promise<string> {
  const code = kiosk.locator('#k-code');
  await expect(code).toHaveText(/^[2-9A-Z]{6}$/, { timeout: 20_000 });
  return (await code.textContent()) ?? '';
}

async function pairedKiosk(page: Page, baseURL: string, org: Org): Promise<void> {
  await page.goto('/kiosk');
  const code = await shownCode(page);
  const paired = await managerPairs(page.request, baseURL, org, code);
  expect(paired.status()).toBe(201);
}

const audible = (page: Page) => expect(page.locator('html')).toHaveAttribute('data-audible', 'yes', { timeout: 60_000 });

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

test.describe('autoplay blocked (BZ-0445-04)', () => {
  test.use({ launchOptions: { args: ['--mute-audio', '--autoplay-policy=document-user-activation-required'] } });

  test('test_autoplay_blocked_shows_tap_to_start', async ({ page, baseURL }) => {
    const org = await makeOrg(page.request);
    await pairedKiosk(page, baseURL!, org);
    const tap = page.getByRole('button', { name: 'Tap to start the music' });
    await expect(tap).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('data-audible', 'no');
    // the manager sees that this player needs a tap (from its health report)
    await expect.poll(async () => {
      const listed = await page.request.get('/api/business/kiosks', { headers: { Authorization: ALICE, 'X-Workspace-ID': org.org } });
      return (await listed.json()).kiosks[0]?.autoplay_allowed;
    }, { timeout: 30_000 }).toBe(false);
    await tap.click();
    await audible(page);
    await expect(page.locator('[data-screen="playing"]')).toBeVisible();
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
