import { expect, test } from '@playwright/test';

// SC-0404-05, local mode: Lucy's settings stay exactly as they were, the person's own provider,
// key and limits included. The Cloud half, where those are hidden, is in
// e2e-cloud/live.cloud.ts.

test('local Lucy settings still offer the provider, limits and the person’s own choices', async ({ page }) => {
  await page.goto('/mixes/lucy');
  await page.getByRole('button', { name: 'Settings' }).click();
  const drawer = page.getByRole('dialog', { name: 'Lucy settings' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Who does the planning')).toBeVisible();
  await expect(drawer.getByText('Built-in (on this computer, no AI service)')).toBeVisible();
  await expect(drawer.getByLabel('Most rounds of thinking per request')).toBeVisible();
  await expect(drawer.getByLabel('Spending limit in US dollars (optional)')).toBeVisible();
  await expect(drawer.getByLabel('Use Lucy')).toBeVisible();
  await expect(drawer.getByText('Share short lyric snippets')).toBeVisible();
  // Nothing from Cloud's version leaks into the local one.
  await expect(drawer.getByText(/turns this month|Lucy Basic|SelectaDJ’s AI provider/)).toHaveCount(0);
});
