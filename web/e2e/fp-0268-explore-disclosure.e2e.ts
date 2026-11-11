import { expect, Locator, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * FP-0268-05: an Explore card's full explanation (why, what it draws from, how it moves, the planning
 * caveat) opens by its named disclosure with a pointer, a touch and the keyboard, and never by hover alone.
 */

test.beforeEach(async ({ request }) => resetMix(request));

const detailOf = (article: Locator) => article.locator('details.vibe-card-detail');

test('the card explanation opens by pointer and keyboard, never by hover alone (FP-0268-05)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/mixes');
  const card = page.locator('article.vibe-card').first();
  const name = await card.locator('h3').innerText();
  const summary = card.getByText(`Why ${name}? More details`);
  await expect(summary).toBeVisible();
  const caveat = card.getByText(/Planning preference, not a promised song order/);

  await summary.hover();
  await page.waitForTimeout(300);
  await expect(detailOf(card)).not.toHaveAttribute('open', '');
  await expect(caveat).toBeHidden();

  await summary.click();
  await expect(caveat).toBeVisible();
  await expect(card.getByText('Draws from')).toBeVisible();
  await summary.click();
  await expect(caveat).toBeHidden();

  for (const key of ['Enter', 'Space']) {
    await summary.focus();
    await page.keyboard.press(key);
    await expect(caveat, key).toBeVisible();
    await expect(summary).toBeFocused();
    await page.keyboard.press(key);
    await expect(caveat, key).toBeHidden();
  }
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 667 } });
  test('a tap on the named disclosure opens and closes the explanation (FP-0268-05)', async ({ page }) => {
    await page.goto('/mixes');
    const card = page.locator('article.vibe-card').first();
    const name = await card.locator('h3').innerText();
    const summary = card.getByText(`Why ${name}? More details`);
    await summary.scrollIntoViewIfNeeded();
    const caveat = card.getByText(/Planning preference, not a promised song order/);
    await summary.tap();
    await expect(caveat).toBeVisible();
    await expect(card.getByText('Draws from')).toBeVisible();
    await summary.tap();
    await expect(caveat).toBeHidden();
  });
});
