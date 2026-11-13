import { expect, test } from '@playwright/test';
import { endRooms, hostWithRoom, slowPhone } from '../e2e-cloud/helpers';

// LF14 browser integration probes for the cloud harness. This .spec.ts is deliberately
// not included in the existing *.e2e.ts runner until the ADR integration owner wires
// a local-engine mock and cloud harness into a dedicated Playwright project.

test.beforeEach(async ({ page }) => { await endRooms(page); });

test('guest distinguishes host acceptance from local speaker scheduling', async ({ browser }) => {
  const { context: hostContext, joinPath } = await hostWithRoom(browser);
  const { context, page } = await slowPhone(browser);
  try {
    await page.goto(joinPath);
    await page.getByRole('button', { name: 'Join the room' }).click();
    await expect(page.getByRole('heading', { name: 'Garden party' })).toBeVisible();
    // Simulate the signed, scoped read-model returned by a local venue bridge;
    // API integration and real speaker acknowledgements are verified in Python.
    await page.route('**/api/guest/rooms/*', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      if (!('my_requests' in body)) return route.fulfill({ response });
      return route.fulfill({
        response,
        json: {
          ...body, local_first: true, music_paused: true,
          my_requests: (body.my_requests ?? []).map((item: Record<string, unknown>) => ({
            ...item, stage: 'deferred',
            text: 'Deferred: the venue speaker or recording is unavailable',
          })),
        },
      });
    });
    await page.getByLabel("Search the host's songs").fill('Song 12');
    await page.getByRole('button', { name: 'Request Song 12 - Artist 5' }).click();
    const mine = page.getByRole('region', { name: 'My requests' });
    await expect(mine).toContainText('Deferred: the venue speaker');
    await expect(page.getByText('The venue speaker is unavailable')).toBeVisible();
    await expect(page.getByText('Accepted guest requests')).toBeVisible();
    await expect(page.locator('audio, video, source')).toHaveCount(0);
    const searchResponse = await page.request.get('/api/guest/rooms/made-up/search?q=Song');
    const publicResponse = await searchResponse.text();
    expect(publicResponse).not.toMatch(/signed_url|file_path|local_path|audio_bytes|raw_pcm/);
  } finally {
    await Promise.all([context.close(), hostContext.close()]);
  }
});

test('rotating an invitation invalidates the old QR join code', async ({ browser }) => {
  const { context: hostContext, host, joinPath } = await hostWithRoom(browser);
  const { context, page } = await slowPhone(browser);
  try {
    await host.getByRole('button', { name: 'Make a new code' }).click();
    await page.goto(joinPath);
    await page.getByRole('button', { name: 'Join the room' }).click();
    await expect(page.getByRole('alert')).toContainText(/no room|valid code|code changed/i);
  } finally {
    await Promise.all([context.close(), hostContext.close()]);
  }
});
