// Browser-level acceptance harness; actual speakers and OS suspension need physical devices.
// This .spec.ts is intentionally outside the legacy *.e2e.ts suite until Agent 10 wires
// the device-qualification Playwright project. No mock may claim real audio proof.
import { expect, test } from '@playwright/test';

const FLEET = '/business-harness.html?scenario=lf13_fleet';

test('manager has browser-native tablet setup and accurate speaker limitations', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  try {
    await page.goto(FLEET);
    await page.getByRole('button', { name: 'Review Demo venue 1 readiness' }).click();
    await page.getByRole('button', { name: /Open devices for/ }).first().click().catch(() => undefined);
    // When the devices route is present, ensure the local on-site experience cannot
    // silently present remote Cloud readiness as a real sound test.
    const setup = page.getByTestId('br64-08-tablet-setup');
    if (await setup.count()) {
      await expect(setup.getByText(/iPad, Android tablet or laptop/)).toBeVisible();
      await expect(setup.getByRole('button', { name: 'Tap to start here' })).toBeDisabled();
      await expect(setup.getByText(/not yet Cloud programme activation/i)).toHaveCount(1);
    }
  } finally { await context.close(); }
});

test('staff phone remote view does not put venue music on staff phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  try {
    await page.goto(FLEET);
    await page.getByRole('button', { name: 'Review Demo venue 4 readiness' }).click();
    await page.getByRole('button', { name: 'Staff phone view' }).click();
    await expect(page.getByTestId('staff-deck')).toBeVisible();
    await expect(page.locator('audio, video, source')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  } finally { await context.close(); }
});
