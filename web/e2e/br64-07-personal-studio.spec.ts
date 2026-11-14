import { expect, test, type Page } from '@playwright/test';

// Synthetic integration fixture exercises real React routes and browser-port wiring.
// It does NOT certify audio quality, iOS background playback, or actual render codecs.
const URL = (process.env.SELECTA_BR64_07_VITE_URL ?? 'http://127.0.0.1:5182') +
  '/src/cloud/lf-mix-repair/br64-07-fixture.html?mix=synthetic_mix';

async function open(page: Page) {
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: 'Eight-song demo' })).toBeVisible();
}
test('5/8 missing exact recordings cannot play, preview or export; editing remains possible', async ({ page }) => {
  await open(page);
  await expect(page.getByText('5 of 8 exact recordings verified')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render and export here' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Preview transition into Synthetic Track 2' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save new version' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Synthetic Track 2 earlier' }).click();
  await expect(page.getByRole('button', { name: 'Save new version' })).toBeEnabled();
  expect(await page.evaluate(() => window.br64Fixture?.counts())).toEqual({ play: 0, render: 0, preview: 0 });
  expect(await page.evaluate(() => window.br64Fixture?.requests.every(
    ({ path }) => !path.includes('/assets') && !path.includes('/uploads'),
  ))).toBe(true);
});

test('phone portrait provides accessible order/cue controls and local rendering when verified', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  await page.evaluate(() => window.br64Fixture?.setMode('all_ready'));
  await expect(page.getByText('8 of 8 exact recordings verified')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview transition into Synthetic Track 2' })).toBeEnabled();
  await page.getByRole('button', { name: 'Preview transition into Synthetic Track 2' }).click();
  expect(await page.evaluate(() => window.br64Fixture?.counts().preview)).toBe(1);
  await page.getByRole('button', { name: 'Render and export here' }).click();
  await expect(page.getByRole('button', { name: 'Download local export' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local export' }).click();
  expect((await download).suggestedFilename()).toBe('synthetic-fixture.wav');
  expect(await page.evaluate(() => window.br64Fixture?.counts().render)).toBe(1);
  await expect(page.getByRole('button', { name: 'Move Synthetic Track 2 earlier' })).toBeVisible();
  // Port availability, not the phone's user-agent or viewport, decides render eligibility.
});

test('browser permissions and alternate mastering remain explicit and fail closed', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.br64Fixture?.setMode('permission_required'));
  await expect(page.getByText('Permission Required').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render and export here' })).toBeDisabled();
  await page.evaluate(() => window.br64Fixture?.setMode('alternative_master'));
  await expect(page.getByText(/Alternate mastering cannot replace/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render and export here' })).toBeDisabled();
  await page.evaluate(() => window.br64Fixture?.setMode('offline'));
  await expect(page.getByText(/Exact recording availability is unknown/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render and export here' })).toBeDisabled();
});

test('optimistic revision conflicts preserve the local draft', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.br64Fixture?.setConflict(true));
  await page.getByRole('button', { name: 'Move Synthetic Track 2 earlier' }).click();
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByText(/A newer revision exists/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
});
