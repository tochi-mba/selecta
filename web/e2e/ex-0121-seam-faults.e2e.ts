import { expect, test, type Page } from '@playwright/test';
import { allRendered, resetMix } from './helpers';

/**
 * EX-0121-03 (Experience programme): a transition the server reports as failed or not rendered is never
 * offered as playable in the real editor. The server's mix answer is rewritten in flight (fault injection),
 * so the page sees exactly what a failed or unrendered render would report.
 */

async function inject(page: Page, status: 'failed' | 'none') {
  await page.route(/\/api\/mix(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    for (const item of body.mix ?? []) {
      if (item.seam) item.seam.state = { status, key: item.seam.state.key, passed: false, error: 'Injected failure' };
    }
    await route.fulfill({ response, json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const status of ['failed', 'none'] as const) {
  test(`EX-0121-03 a ${status} transition offers no audio and no rating`, async ({ page, request }) => {
    await resetMix(request, [1, 2]);
    await allRendered(request);
    await inject(page, status);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/mix/current/edit');
    await expect(page.locator('main#main')).toBeVisible();
    const row = page.locator('.timeline .seam').first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Hear it', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Good', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    const inspector = page.locator('.inspector').first();
    await expect(inspector.locator('.inspector-identity')).toBeVisible();
    await inspector.getByRole('tab', { name: 'Listen' }).click();
    await expect(inspector.locator('audio')).toHaveCount(0);
    await expect(inspector.getByRole('group', { name: 'Rate this seam' })).toHaveCount(0);
    if (status === 'failed') await expect(inspector.getByText(/couldn’t be made/)).toBeVisible();
    else await expect(inspector.getByRole('button', { name: 'Render it' })).toBeVisible();
  });
}
