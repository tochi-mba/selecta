import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

test.beforeEach(async ({ request }) => resetMix(request));

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 1280, height: 600 },
]) {
  test(`dialog actions remain exposed above secondary chrome at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/mixes');
    const opener = page.getByRole('button', { name: 'Customize' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Shape the next mix' });
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Done shaping' });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    const occlusion = await page.evaluate(() => {
      const overlay = document.querySelector<HTMLElement>('.overlay');
      const notices = document.querySelector<HTMLElement>('.toasts');
      const action = [...document.querySelectorAll<HTMLButtonElement>('.overlay-foot button')]
        .find((button) => button.textContent?.includes('Done shaping'));
      if (!overlay || !notices || !action) return 'missing critical overlay';
      const dialogLayer = Number(getComputedStyle(overlay).zIndex);
      const noticeLayer = Number(getComputedStyle(notices).zIndex);
      if (dialogLayer <= noticeLayer) return 'toast layer covers dialog';
      const bounds = action.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > innerHeight || bounds.left < 0 || bounds.right > innerWidth) {
        return 'dialog action clipped by viewport';
      }
      const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return top === action || action.contains(top) ? null : 'dialog action physically obscured';
    });
    expect(occlusion).toBeNull();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}

test('software keyboard makes notification chrome yield without removing notices or the mini-player', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  // The mini-player is intentionally absent on Listen itself; it lives on other routes.
  await page.goto('/library');
  await expect(page.locator('.mini')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.keyboard = 'open'; });
  await expect(page.locator('.mini')).toBeHidden();
  await expect(page.locator('.toasts')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.toasts')).toHaveCount(1);
  await page.evaluate(() => { delete document.documentElement.dataset.keyboard; });
  await expect(page.locator('.mini')).toBeVisible();
  await expect(page.locator('.toasts')).toHaveCSS('visibility', 'visible');
});
