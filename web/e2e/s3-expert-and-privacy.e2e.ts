import { expect, test } from '@playwright/test';
import { allRendered, audioStates, PAGES, resetMix, soundsStarted, spyOnAudio } from './helpers';

// S3-0068-04/06/07: the command palette opens and closes without stealing keys or focus, never
// replaces what's playing, and can be turned off. S3-0072-08: nothing in navigation, playback or
// a preview talks to anything but the local server.

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test('S3-0068-07 Ctrl K leaves text boxes alone, and Escape puts focus back where it was', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const search = page.getByRole('searchbox').or(page.getByRole('textbox')).first();
  await search.focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search and commands' })).toHaveCount(0);
  await expect(search).toBeFocused();

  const opener = page.getByRole('button', { name: 'Search and commands' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const box = page.getByRole('combobox', { name: 'Search for a page or a command' });
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Search and commands' })).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/\/library/);

  // choosing a place moves there and puts focus on the new page, not on a closed dialog
  await page.keyboard.press('Control+k');
  await box.fill('workspace');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workshop/);
  await expect(page.getByRole('dialog', { name: 'Search and commands' })).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement !== document.body && !!document.activeElement?.closest('main, #main, [role="main"]'))).toBe(true);
});

test('S3-0068-04 Enter on Start a new mix opens Explore and leaves the music playing', async ({ page, request }) => {
  await spyOnAudio(page);
  await allRendered(request);
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const started = await soundsStarted(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search for a page or a command' }).fill('start a new mix');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/mixes$/);
  await page.waitForTimeout(500);
  expect(await audioStates(page)).toEqual(['running']);
  expect(await soundsStarted(page)).toBe(started);
  await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();
});

test('S3-0068-06 the palette can be turned off, and then Ctrl K and its button are gone', async ({ page }) => {
  await page.goto('/listen');
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Ctrl K');
  await help.getByRole('checkbox', { name: 'Use Ctrl K for search and commands' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search and commands' })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: 'Search and commands' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search and commands' })).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
});

test('S3-0072-08 navigating everywhere, playing and previewing only ever asks the local server', async ({ page, request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const away: string[] = [];
  page.on('request', (sent) => {
    const url = sent.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) away.push(url);
  });
  await allRendered(request);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  }
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Hear it' }).first().click();
  const preview = page.locator('audio.preview').first();
  await expect(preview).toBeVisible();
  await preview.evaluate((element: HTMLAudioElement) => element.play().catch(() => {}));
  await page.waitForTimeout(800);
  expect(away).toEqual([]);
});
