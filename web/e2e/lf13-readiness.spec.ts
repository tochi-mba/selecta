// Agent 13 browser contract. The business harness is built only for E2E and contains invented
// local-venue reports; nothing in these tests needs licensed audio or a live venue.
// Discovery wiring is documented in docs/integration/lf13.md (global configs are owned elsewhere).
import { expect, test } from '@playwright/test';

const FLEET = '/business-harness.html?scenario=lf13_fleet';

test('twenty venues show mixed health with three failing zones and offline playback', async ({ page }) => {
  await page.goto(FLEET);
  const panel = page.getByTestId('lf13-hq');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-venue-readiness]')).toHaveCount(20);
  await expect(panel.getByText('16 of 20 venues activation-ready')).toBeVisible();
  await expect(panel.locator('[data-venue-readiness="healthy"]')).toHaveCount(16);
  await expect(panel.locator('[data-venue-readiness="degraded"]')).toHaveCount(2);
  await expect(panel.locator('[data-venue-readiness="silent"]')).toHaveCount(1);
  await expect(panel.locator('[data-venue-readiness="offline"]')).toHaveCount(1);
});

test('manager recovery is actionable for an unavailable drive', async ({ page }) => {
  await page.goto(FLEET);
  await page.getByRole('button', { name: 'Review Demo venue 4 readiness' }).click();
  await expect(page.getByRole('heading', { name: 'Local playback readiness' })).toBeVisible();
  await expect(page.getByText('Local music source unavailable')).toBeVisible();
  await expect(page.getByText(/Reconnect the authorised music drive/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Open devices for Local music source unavailable/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh verified reports' })).toBeVisible();
});

test('failing speaker cannot be presented as healthy', async ({ page }) => {
  await page.goto(FLEET);
  await page.getByRole('button', { name: 'Review Demo venue 8 readiness' }).click();
  await expect(page.locator('[data-zone-readiness="silent"]')).toHaveCount(1);
  await expect(page.getByText('Speaker has no confirmed audio')).toBeVisible();
  await expect(page.getByText(/Physical speaker not verified/)).toBeVisible();
  await expect(page.getByText(/not verified for activation/i)).toBeVisible();
});

test('offline playing is labelled as last-known, not current output', async ({ page }) => {
  await page.goto(FLEET);
  await page.getByRole('button', { name: 'Review Demo venue 15 readiness' }).click();
  await expect(page.locator('[data-zone-readiness="offline"]')).toHaveCount(1);
  await expect(page.getByText(/Local music was last confirmed running/)).toBeVisible();
  await expect(page.getByText(/not verified for activation/i)).toBeVisible();
});

test('manager actions remain keyboard reachable at 320 CSS pixels', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(FLEET);
  const panel = page.getByTestId('lf13-hq');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Review Demo venue 1 readiness' }).focus();
  await expect(panel.getByRole('button', { name: 'Review Demo venue 1 readiness' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Local playback readiness' })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector('.lf13-detail');
    return panel ? Math.round(panel.scrollWidth - panel.clientWidth) : 1;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});
