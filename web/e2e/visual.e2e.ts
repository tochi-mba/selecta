import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * Review candidates, NOT approved golden baselines. Captures only the synthetic
 * fixture from tests/e2e_server.py. Uploaded by the Edge jobs so owners can
 * assess layout and approve versioned screenshot comparisons separately.
 * A green test here proves the image was captured, not that it looks correct.
 */
const VIEWS = [
  { path: '/mixes', name: 'explore' },
  { path: '/listen', name: 'listen' },
  { path: '/mixes/mine', name: 'my-mixes' },
  { path: '/mix/current/edit', name: 'editor' },
  { path: '/library', name: 'library' },
  { path: '/workshop', name: 'workspace' },
] as const;

const DISPLAYS = [
  { width: 320, height: 640, scheme: 'light' },
  { width: 375, height: 812, scheme: 'dark' },
  { width: 1280, height: 900, scheme: 'light' },
  { width: 1440, height: 900, scheme: 'dark' },
] as const;

test.beforeEach(async ({ request }) => resetMix(request));

for (const display of DISPLAYS) {
  test(`capture 3.1 visual review candidates at ${display.width}px in ${display.scheme}`, async ({ page, request }, info) => {
    await page.setViewportSize({ width: display.width, height: display.height });
    await page.emulateMedia({ colorScheme: display.scheme, reducedMotion: 'reduce' });
    const capture = async (name: string) => {
      await page.screenshot({
        path: info.outputPath(`candidate-${display.width}-${display.scheme}-${name}.png`),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
      });
    };

    for (const view of VIEWS) {
      await page.goto(view.path);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      // Let local synthetic status and font layout settle. These are intentionally
      // review artifacts, never automatically blessed pixel baselines.
      await page.waitForTimeout(220);
      await capture(view.name);
    }

    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Download audio' }).click();
    await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
    await capture('export-dialog');

    await page.goto('/mixes');
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('dialog', { name: 'How mixes get built' })).toBeVisible();
    await capture('customize-dialog');

    await page.goto('/listen');
    await page.keyboard.press('r');
    await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible();
    await capture('requests-dialog');

    await page.goto('/library');
    await page.getByRole('button', { name: /^Details for Paper Moon/ }).click();
    await expect(page.getByRole('dialog', { name: 'Paper Moon' })).toBeVisible();
    await capture('song-details');

    await page.goto('/library?q=nothing-is-called-this');
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await capture('library-no-results');

    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    await expect(page.getByRole('tab', { name: 'Change' })).toBeVisible();
    await capture('transition-inspector');

    await resetMix(request, [8, 5, 6, 10, 11]);
    await page.goto('/mix/current/edit');
    await expect(page.getByRole('button', { name: 'Download audio' })).toBeVisible();
    await capture('editor-long-and-rtl-names');
    await page.goto('/listen');
    await expect(page.locator('.lyrics')).toBeVisible();
    await capture('listen-long-title');

    await request.post('/api/mix/clear');
    await page.goto('/mix/current/edit');
    await page.waitForTimeout(220);
    await capture('editor-empty');
    await page.goto('/listen');
    await page.waitForTimeout(220);
    await capture('listen-nothing-to-hear');
    await resetMix(request);

    // a page that's open when the server goes away, and the same page when it's back
    await page.goto('/library');
    await expect(page.locator('.library-rows .song-row').first()).toBeVisible();
    await page.route('**/api/**', (route) => route.abort());
    await expect(page.getByRole('alert').filter({ hasText: 'Can’t reach Selecta' })).toBeVisible({ timeout: 15_000 });
    await capture('server-gone');
    await page.goto('/mixes').catch(() => {});
    await expect(page.getByRole('heading', { name: 'Can’t reach Selecta.' })).toBeVisible({ timeout: 15_000 });
    await capture('server-never-reached');
    await page.unroute('**/api/**');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 15_000 });
    await capture('server-back');

    // someone with no music added yet
    const status = await (await request.get('/api/status')).json();
    await page.route('**/api/status', (route) => route.fulfill({ json: { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 } } }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Where’s your music?' })).toBeVisible();
    await capture('first-run');
    await page.unroute('**/api/status');
  });
}
