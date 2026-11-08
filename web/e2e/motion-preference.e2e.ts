import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

test.beforeEach(async ({ request }) => resetMix(request));

test('motion intensity is local and OS reduced-motion always wins', async ({ page }) => {
  await page.goto('/workshop');
  const expressive = page.getByRole('radio', { name: 'Expressive' });
  await expressive.check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'expressive');
  await expect.poll(() => page.locator('html').evaluate((root) => getComputedStyle(root).getPropertyValue('--motion-fast').trim())).toBe('120ms');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('html').evaluate((root) => getComputedStyle(root).getPropertyValue('--motion-fast').trim())).toBe('0ms');

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Expressive' })).toBeChecked();
  await page.getByRole('radio', { name: 'Still' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'still');
});
