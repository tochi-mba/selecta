import { expect, test } from '@playwright/test';
import { PAGES, resetMix } from './helpers';

// Flow SF-0204-02, the automatable part: on every page the main content shows at most one primary
// action, and that one is enabled and reachable from the keyboard. Whether people find it is the
// usability test's part.

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test('every page shows at most one primary action, and the keyboard reaches it', async ({ page }) => {
  for (const address of PAGES) {
    await page.goto(address);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const primaries = page.locator('main :is(button, a).primary:visible').filter({ hasNot: page.locator('dialog') });
    const count = await primaries.count();
    expect(count, `${address} shows ${count} primary actions`).toBeLessThanOrEqual(1);
    if (count === 1) {
      const primary = primaries.first();
      await expect(primary, `${address} primary is enabled`).toBeEnabled();
      expect(await primary.evaluate((node) => (node as HTMLElement).tabIndex), `${address} primary is in the tab order`).toBeGreaterThanOrEqual(0);
      await primary.focus();
      await expect(primary).toBeFocused();
    }
  }
});
