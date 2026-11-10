import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { PAGES, resetMix } from './helpers';

/**
 * ADR-0077 (S3-0077-03/04/06): the theme can be chosen from the header, Workspace and the command
 * palette, every one of them shows the same current choice, and contrast holds when Light or Dark
 * is chosen explicitly against the computer's own setting. Whether both themes look right to a
 * person is the owner's call, not this test's.
 */

test.beforeEach(async ({ request }) => resetMix(request));

const shown = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? 'system');

async function headerChecked(page: Page) {
  await page.locator('.theme-menu > button').first().click();
  const checked = await page.getByRole('menuitemradio', { checked: true }).allTextContents();
  await page.keyboard.press('Escape');
  return checked.map((text) => text.trim());
}

test('header, Workspace and palette choose the theme and all show the same current choice (S3-0077-03)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/workshop');
  await page.evaluate(() => localStorage.removeItem('selecta.prefs'));
  await page.reload();
  const group = page.getByRole('radiogroup', { name: 'Theme' });
  await expect(group).toBeVisible();
  await expect(group.getByRole('radio', { name: 'Match this computer' })).toBeChecked();
  expect(await headerChecked(page)).toEqual(['Match this computer']);

  // Workspace radio group
  await group.getByRole('radio', { name: 'Light' }).check();
  expect(await shown(page)).toBe('light');
  expect(await headerChecked(page)).toEqual(['Light']);

  // header menu, from the keyboard
  await page.locator('.theme-menu > button').first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitemradio', { name: 'Dark' }).focus();
  await page.keyboard.press('Enter');
  expect(await shown(page)).toBe('dark');
  await expect(group.getByRole('radio', { name: 'Dark' })).toBeChecked();

  // command palette: the current choice is offered as already in use, another one applies
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Search for a page or a command' });
  await box.fill('Theme: dark');
  await expect(page.getByRole('option', { name: /Theme: dark/ })).toHaveAttribute('aria-disabled', 'true');
  await box.fill('Theme: light');
  await page.getByRole('option', { name: /Theme: light/ }).click();
  expect(await shown(page)).toBe('light');
  await expect(group.getByRole('radio', { name: 'Light' })).toBeChecked();
  expect(await headerChecked(page)).toEqual(['Light']);

  // it stays chosen
  await page.reload();
  expect(await shown(page)).toBe('light');
  await expect(page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' })).toBeChecked();
  await page.evaluate(() => localStorage.removeItem('selecta.prefs'));
});

for (const { chosen, os } of [{ chosen: 'light', os: 'dark' }, { chosen: 'dark', os: 'light' }] as const) {
  test(`every page passes automatic contrast checks with ${chosen} chosen while the computer is ${os} (S3-0077-04/06)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: os, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/mixes');
    await page.evaluate((theme) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme })), chosen);
    const found: string[] = [];
    for (const address of PAGES) {
      await page.goto(address);
      await expect(page.locator('html')).toHaveAttribute('data-theme', chosen);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.waitForTimeout(400);
      const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      for (const problem of violations) {
        for (const node of problem.nodes) found.push(`${address}: ${String(node.target)} ${node.failureSummary?.split('\n')[1]?.trim() ?? ''}`);
      }
    }
    await page.evaluate(() => localStorage.removeItem('selecta.prefs'));
    expect(found).toEqual([]);
  });
}
