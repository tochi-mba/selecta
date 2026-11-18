import { expect, Page, test } from '@playwright/test';

/**
 * MP-0279 on the cloud harness (BF overhaul W6): the Cloud, Rooms and devices patterns gallery at
 * `/harness?page=gallery` (web/src/harness/CloudGallery.tsx), measured on the Cloud site's own
 * sheets in Edge. It needs no account and reads nothing from the server. The axe pass for the same
 * page is in bf-accessibility.cloud.ts (site.cloud.gallery). Candidate evidence, not approval.
 */
async function openGallery(page: Page, width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/harness?page=gallery');
  await expect(page.getByRole('heading', { level: 1, name: 'SelectaDJ Cloud patterns' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0279 cloud: every status kind, the meters and the honest states are on the cloud sheets', async ({ page }) => {
  await openGallery(page);
  await expect(page.locator('.status')).not.toHaveCount(0);
  expect(await page.locator('section').first().locator('.status').count(), 'all 11 status kinds').toBe(11);
  await expect(page.getByRole('progressbar', { name: 'Files checked', exact: true })).toHaveAttribute('aria-valuenow', '705');
  await expect(page.getByRole('meter', { name: 'Hosted storage' })).toBeVisible();
  for (const heading of ['Statuses, actions and meters', 'Onboarding and connecting music', 'Honest states', 'Rooms and devices']) {
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  }
  // the cloud sheets really apply: a card has the raised surface and a radius, not browser defaults
  const card = await page.locator('.cloud-card').first().evaluate((element) => ({ radius: getComputedStyle(element).borderRadius, background: getComputedStyle(element).backgroundColor }));
  expect(card.radius).not.toBe('0px');
  expect(card.background).not.toBe('rgba(0, 0, 0, 0)');
});

test('MP-0279 cloud: a visually hidden picker is reached by Tab and its label shows the ring', async ({ page }) => {
  await openGallery(page);
  const input = page.locator('#g-files');
  await input.focus();
  await expect(input).toBeFocused();
  const ring = await page.locator('label.cloud-spine-pick').first().evaluate((label) => getComputedStyle(label).outlineStyle);
  expect(ring).not.toBe('none');
});

test('MP-0279 cloud: a destructive confirmation keeps focus safe and gives it back', async ({ page }) => {
  await openGallery(page);
  const opener = page.getByRole('button', { name: 'Forget this device' });
  await opener.click();
  const dialog = page.getByRole('alertdialog', { name: 'Forget this device?' });
  await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText('Checked for this demonstration.')).toBeVisible();
});

test('MP-0279 cloud: usable at 320 px, nothing moves with reduced motion, focus always shows', async ({ page }) => {
  await openGallery(page, 320, 640);
  const found = await page.evaluate(() => {
    const room = window.innerWidth;
    const controls = [...document.querySelectorAll<HTMLElement>('button, input, select, label')].filter((control) => control.getClientRects().length);
    return {
      overflow: document.documentElement.scrollWidth - room,
      outside: controls.filter((control) => control.getBoundingClientRect().right > room + 1).map((control) => control.textContent?.trim() || control.getAttribute('aria-label')),
      moving: document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity).length,
    };
  });
  expect(found.overflow, 'scrolls sideways').toBeLessThanOrEqual(0);
  expect(found.outside, 'controls off screen').toEqual([]);
  expect(found.moving, 'endless animations with reduced motion asked for').toBe(0);
  const unmarked: string[] = [];
  await page.locator('body').focus();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const label = element.closest('label');
      const marked = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
        || (!!label && getComputedStyle(label).outlineStyle !== 'none');
      return { name: (element.getAttribute('aria-label') || element.innerText || element.id || element.tagName).trim().slice(0, 40), marked };
    });
    if (stop && !stop.marked) unmarked.push(stop.name);
  }
  expect(unmarked, 'stops with no visible focus').toEqual([]);
});
