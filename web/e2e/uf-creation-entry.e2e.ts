import { expect, Locator, Page, test } from '@playwright/test';
import { resetMix, soundsStarted, spyOnAudio } from './helpers';

/** UF-0376-08 and UF-0377-07: Make a Mix cards keep their facts and safe touch targets on a phone, and
 * the Library's song details neither lose focus nor hide the player at a 400% zoom equivalent. */

test.beforeEach(async ({ request }) => resetMix(request));

/** Whatever is drawn at the middle of a control is that control, so nothing covers it. */
const uncovered = (control: Locator) => control.evaluate((element) => {
  const box = element.getBoundingClientRect();
  const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!top && (top === element || element.contains(top));
});

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

for (const width of [320, 375]) {
  test.describe(`a ${width}px touch phone`, () => {
    test.use({ viewport: { width, height: 700 }, hasTouch: true });

    test(`UF-0376-08 Make a Mix cards keep their facts and 44px actions at ${width}px`, async ({ page }) => {
      await page.goto('/mixes');
      const cards = page.locator('article.vibe-card');
      await expect(cards.first()).toBeVisible({ timeout: 30_000 });
      await noSidewaysScroll(page);
      const count = await cards.count();
      expect(count).toBeGreaterThan(1);
      for (let index = 0; index < count; index += 1) {
        const card = cards.nth(index);
        await card.scrollIntoViewIfNeeded();
        // the comparison facts stay on every card, not only on a wide screen
        await expect(card.locator('.vibe-card-facts')).toBeVisible();
        const box = await card.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
        const actions = card.locator('.card-actions button, .card-actions a');
        for (let at = 0; at < await actions.count(); at += 1) {
          const action = actions.nth(at);
          if (!(await action.isVisible())) continue;
          await action.scrollIntoViewIfNeeded();
          const target = await action.boundingBox();
          expect(target!.height, `${await action.textContent()} height`).toBeGreaterThanOrEqual(44);
          expect(target!.width, `${await action.textContent()} width`).toBeGreaterThanOrEqual(44);
          expect(target!.x + target!.width).toBeLessThanOrEqual(width + 0.5);
          expect(await uncovered(action), `${await action.textContent()} is covered`).toBe(true);
        }
      }
    });
  });
}

test('UF-0377-07 song details keep focus and leave the player usable at 320px (400% zoom)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  const mini = page.locator('.mini');
  await expect(mini).toBeVisible();

  const opener = page.getByRole('button', { name: /^Details for / }).first();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  // focus moved into the details, and Tab stays inside them
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  // every control in the details can be reached without anything drawn over it
  const controls = dialog.locator('button:visible');
  for (let at = 0; at < await controls.count(); at += 1) {
    const control = controls.nth(at);
    await control.scrollIntoViewIfNeeded();
    expect(await uncovered(control), `${await control.getAttribute('aria-label') ?? await control.textContent()} is covered`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  // the music carried on, and the player is visible and not covered
  const pause = mini.getByRole('button', { name: 'Pause' });
  await expect(pause).toBeVisible();
  expect(await uncovered(pause)).toBe(true);
  await noSidewaysScroll(page);
});

test('UF-0372-05 opening the app, Make a Mix, Listen and Library never starts music by itself', async ({ page }) => {
  await spyOnAudio(page);
  for (const address of ['/', '/mixes', '/listen', '/library']) {
    await page.goto(address);
    await expect(page.locator('main#main')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    expect(await soundsStarted(page), `${address} started a sound`).toBe(0);
  }
  // Play is offered on Make a Mix because the made-up library has ready songs, and it waits to be pressed
  await page.goto('/mixes');
  const play = page.locator('.mix-quick').getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  expect(await soundsStarted(page)).toBe(0);
});
