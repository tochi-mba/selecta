import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * ADR-0068 (S3-0068-04/05/06/07): the shortcut list is reachable with ? and lists what is really on,
 * the palette can be turned off and on again from it, Ctrl K steps aside for an open dialog and for a
 * text box, Escape gives focus back, and no palette command replaces the mix that is playing.
 */

test.beforeEach(async ({ request }) => resetMix(request));

test('the shortcut list turns the palette off and on, and Ctrl K respects dialogs and text boxes (S3-0068-05/06)', async ({ page }) => {
  await page.goto('/library');
  await page.evaluate(() => localStorage.removeItem('selecta.prefs'));
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const box = page.getByRole('combobox', { name: 'Search for a page or a command' });

  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.locator('kbd', { hasText: 'Ctrl K' })).toBeVisible();
  // a dialog owns the keys: Ctrl K does not open the palette on top of it
  await page.keyboard.press('Control+k');
  await expect(box).toHaveCount(0);
  await help.getByRole('checkbox', { name: 'Use Ctrl K for search and commands' }).uncheck();
  await expect(help.locator('kbd', { hasText: 'Ctrl K' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);

  await page.locator('main#main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+k');
  await expect(box).toHaveCount(0);

  await page.keyboard.press('?');
  await help.getByRole('checkbox', { name: 'Use Ctrl K for search and commands' }).check();
  await page.keyboard.press('Escape');

  // a text box keeps its own keys
  const search = page.getByRole('searchbox').first();
  await search.focus();
  await page.keyboard.press('Control+k');
  await expect(box).toHaveCount(0);
  await expect(search).toBeFocused();

  // from the page it opens, and Escape gives focus back to where it was
  const opener = page.getByRole('link', { name: 'Library' }).first();
  await opener.focus();
  await page.keyboard.press('Control+k');
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.evaluate(() => localStorage.removeItem('selecta.prefs'));
});

test('Enter on Start a new mix only goes to Explore, and the mix that is playing carries on (S3-0068-04/07)', async ({ page, request }) => {
  await page.goto('/listen');
  const songs = async () => ((await (await request.get('/api/mix')).json()).mix as { title: string }[]).map((song) => song.title);
  const before = await songs();
  expect(before.length).toBe(4);
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Search for a page or a command' });
  await box.fill('Start a new mix');
  const option = page.getByRole('option', { name: /^Action: Start a new mix/ });
  await expect(option).toBeVisible();
  if ((await option.getAttribute('aria-disabled')) === 'true') {
    await page.keyboard.press('Enter');
    await expect(box).toBeVisible();
  } else {
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/mixes$/);
  }
  expect(await songs()).toEqual(before);
});
