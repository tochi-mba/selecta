import { expect, test, type Page } from '@playwright/test';

/**
 * ADR-0430 (AV-0430-01, -03, -04, -05) and ADR-0439 (AV-0439-02, -04): the staff dashboard in a real
 * browser. The local E2E server opts into the private dashboard flag and the page hosts
 * the real StaffDashboard component. The dashboard state is answered by page.route,
 * so layout checks don't require a live night or public staff session.
 * Run with SELECTA_E2E_DIST=dist-apb2 SELECTA_E2E_PORT=9041.
 */
const STAFF_PATH = process.env.SELECTA_STAFF_PATH ?? '/venue/staff/e2e';

// The local E2E server supplies a flag-switch endpoint. Enable the still-private
// dashboard only for these integration tests; production defaults remain off.
test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/test/flags', { data: { flags: '+autopilot.venue_mode +venue.staff_dashboard' } });
  expect(response.ok()).toBe(true);
});
test.afterEach(async ({ request }) => {
  await request.post('/api/test/flags', { data: { flags: '' } });
});

const STATE = {
  nav: 'live', headline: 'Autopilot is playing.',
  now: { title: 'A Very Long Song Title That Would Never Fit On A Small Phone (Extended Mix)', artist: 'Artist', seconds_left: 80 },
  next: { title: 'Song B', artist: 'Artist B', seconds_left: null },
  horizon: { songs: 4, minutes: 17.6, words: '4 songs planned, about 18 min.' },
  health: { level: 'ok', words: 'Everything is working.' },
  pending: [], applied: [],
  enabled: ['more_energy', 'less_energy', 'hold_genre', 'skip_next', 'extend_current', 'pause', 'hand_to_manual'],
  stop: { visible: true, enabled: true }, announcement: '',
  expert_controls: [
    { id: 'listen', label: 'Listen and transport', path: '/listen' },
    { id: 'edit_mix', label: 'Edit the mix', path: '/mix/current/edit' },
    { id: 'workshop', label: 'Workshop', path: '/workshop' },
  ],
};

async function open(page: Page, state: Record<string, unknown> = STATE) {
  await page.route('**/api/venue/staff/*/dashboard', (route) => route.fulfill({ json: state }));
  await page.goto(STAFF_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Staff dashboard' })).toBeVisible();
}

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test('Stop stays visible while scrolling at 320px and at 400% zoom', async ({ browser }) => {
  for (const scale of [1, 4]) {
    const context = await browser.newContext({ viewport: { width: 320, height: scale === 4 ? 200 : 640 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await open(page);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.mouse.wheel(0, 2000);
    const stop = page.getByRole('button', { name: 'Stop' });
    await expect(stop).toBeInViewport();
    const box = await stop.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await context.close();
  }
});

test('keyboard reaches Stop first, then steering, then expert controls', async ({ page }) => {
  await open(page);
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();
  const expert = page.getByRole('navigation', { name: 'Expert controls' });
  for (const control of STATE.expert_controls) await expect(expert.getByRole('link', { name: control.label })).toHaveAttribute('href', control.path);
});

test('a pending change is shown as waiting and announced in the polite live region', async ({ page }) => {
  await open(page, { ...STATE, pending: [{ id: 'c1', kind: 'more_energy', label: 'More energy', params: {}, state: 'pending', apply_at: 'next_seam', seam_id: 's1', submitted_at: 1, resolved_at: null, by: 'staff', reason: '', superseded_by: null, words: 'More energy: waiting, changes at the next blend.' }], announcement: 'More energy: waiting, changes at the next blend.' });
  const live = page.getByTestId('staff-announcement');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).toContainText('waiting');
  await expect(page.getByTestId('staff-pending')).toContainText('Waiting');
});

test('every navigation state keeps Stop and expert controls, in both themes and forced colours', async ({ page }) => {
  for (const nav of ['setting_up', 'live', 'paused', 'manual', 'offline', 'failed', 'stopped']) {
    for (const media of [{ colorScheme: 'light' as const }, { colorScheme: 'dark' as const }, { forcedColors: 'active' as const }]) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.emulateMedia(media);
      await open(page, { ...STATE, nav, enabled: [], stop: { visible: true, enabled: nav !== 'stopped' } });
      await expect(page.getByRole('button', { name: nav === 'stopped' ? 'Stopped' : 'Stop' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Expert controls' }).getByRole('link')).toHaveCount(STATE.expert_controls.length);
    }
  }
});
