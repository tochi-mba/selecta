import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

test.beforeEach(async ({ request }) => resetMix(request));

/** The fast motion token, in milliseconds. The production CSS minifier writes durations in their
 * shortest form (120ms becomes .12s, 0ms becomes 0s), so compare the length of time, not the text. */
async function fastMotionMs(page: Page): Promise<number> {
  const value = await page.locator('html').evaluate((root) => getComputedStyle(root).getPropertyValue('--motion-fast').trim());
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(value);
  if (!match) return Number.NaN;
  return Math.round(Number(match[1]) * (match[2] === 's' ? 1000 : 1));
}

test('motion intensity is local and OS reduced-motion always wins', async ({ page }) => {
  await page.goto('/workshop');
  const expressive = page.getByRole('radio', { name: 'Expressive' });
  await expressive.check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'expressive');
  await expect.poll(() => fastMotionMs(page)).toBe(120);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => fastMotionMs(page)).toBe(0);

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Expressive' })).toBeChecked();
  await page.getByRole('radio', { name: 'Still' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'still');
});
