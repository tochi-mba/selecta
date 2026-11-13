import { test, expect } from '@playwright/test';

/** Real UI contract probes. These use actual browser assertions, not mocks. */
function configuredUrl(key: string): string {
  const value = process.env[key];
  if (!value || !/^https?:\/\/[^/]+/.test(value)) {
    throw new Error(`LF19 integration BLOCKED: ${key} missing or not an absolute URL`);
  }
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) &&
      process.env.SELECTA_LF_E2E_ALLOW_STAGING !== 'yes') {
    throw new Error(`LF19 integration BLOCKED: ${key} must target loopback or explicitly authorised staging`);
  }
  return value;
}

test('five of eight recordings are visible and missing media cannot play', async ({ page }) => {
  await page.goto(configuredUrl('SELECTA_LF_E2E_FIVE_OF_EIGHT_URL'));
  await expect(page.getByTestId('lf-target-device')).toContainText('engine-a');
  await expect(page.getByTestId('lf-readiness-count')).toContainText(/5\s*\/\s*8/);
  await expect(page.getByTestId('lf-play-here')).toBeDisabled();
  await expect(page.getByTestId('lf-edit-recipe')).toBeEnabled();
  await expect(page.getByTestId('lf-source-status')).toContainText(/missing|needs attention/i);
});

test('controller-only context does not pretend to have a local player', async ({ page }) => {
  await page.goto(configuredUrl('SELECTA_LF_E2E_CONTROLLER_URL'));
  await expect(page.getByTestId('lf-device-role')).toContainText(/controller.only/i);
  await expect(page.getByTestId('lf-play-here')).toBeDisabled();
  await expect(page.getByTestId('lf-remote-control')).toBeVisible();
});

test('partitioned original speaker refuses unsafe takeover', async ({ page }) => {
  // A real deterministic staging fixture must partition the source speaker and
  // instrument its output. A cloud "accepted" response alone is insufficient.
  await page.goto(configuredUrl('SELECTA_LF_E2E_PARTITION_URL'));
  await page.getByTestId('lf-request-takeover').click();
  await expect(page.getByTestId('lf-takeover-result')).toContainText(/refused|unsafe|cannot confirm/i);
  await expect(page.getByTestId('lf-original-speaker')).toContainText(/playing|unknown/i);
  await expect(page.getByTestId('lf-new-speaker')).not.toContainText(/confirmed playing/i);
});

test('stale availability must be clearly labelled and not act as a ready state', async ({ page }) => {
  await page.goto(configuredUrl('SELECTA_LF_E2E_STALE_URL'));
  await expect(page.getByTestId('lf-source-status')).toContainText(/stale|unknown/i);
  await expect(page.getByTestId('lf-play-here')).toBeDisabled();
});

test('venue HQ distinguishes unknown output from verified playing', async ({ page }) => {
  await page.goto(configuredUrl('SELECTA_LF_E2E_VENUE_URL'));
  await expect(page.getByTestId('lf-output-state')).toContainText(/unknown|degraded|silent/i);
  await expect(page.getByTestId('lf-output-state')).not.toContainText(/verified playing/i);
  await expect(page.getByTestId('lf-zone-list')).toBeVisible();
});

test('400-percent zoom retains access to source recovery action', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(configuredUrl('SELECTA_LF_E2E_FIVE_OF_EIGHT_URL'));
  await page.evaluate(() => { document.documentElement.style.zoom = '4'; });
  await expect(page.getByTestId('lf-edit-recipe')).toBeAttached();
  await expect(page.getByTestId('lf-source-status')).toBeAttached();
});
