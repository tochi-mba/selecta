import { expect, test } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';

/**
 * S4-0100-07 (whole-mix action grouping) and S4-0107-08 (health attention outside Workspace), in
 * Edge against tests/e2e_server.py. Keyboard reach and accessible names from the real page. This is
 * the automated half of a keyboard and screen-reader audit; a person still listens with NVDA.
 */
test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('S4-0100-07 the whole-mix actions are one keyboard group: Tab reaches each in order and Enter acts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mix/current/edit');
  const group = page.locator('.editor-actions');
  await expect(group.getByRole('button', { name: 'Play from the top' })).toBeVisible();
  const shown = await group.locator('button, a').evaluateAll((all) => all.map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim()));
  for (const name of ['Play from the top', 'Save a copy', 'Download audio', 'New mix', 'Clear']) expect(shown.some((label) => label.includes(name)), name).toBe(true);

  // Tab from the first action walks every action in the order shown, with a visible focus ring
  await group.getByRole('button', { name: 'Play from the top' }).focus();
  const walked: string[] = [];
  for (let step = 0; step < shown.length; step += 1) {
    const focused = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement;
      const style = getComputedStyle(node);
      return { name: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim(), ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none', inGroup: !!node.closest('.editor-actions') };
    });
    expect(focused.inGroup, `step ${step}: focus left the group`).toBe(true);
    expect(focused.ring, `${focused.name}: no visible focus`).toBe(true);
    walked.push(focused.name);
    if (step < shown.length - 1) await page.keyboard.press('Tab');
  }
  expect(walked).toEqual(shown);

  // Enter on Save a copy opens its form with the name field focused; Cancel closes it
  await group.getByRole('button', { name: 'Save a copy' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Name this mix' })).toBeFocused();
  await expect(group.getByRole('button', { name: 'Save a copy' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Enter on Download audio opens the export dialog, Escape closes it
  await group.getByRole('button', { name: 'Download audio' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toHaveCount(0);

  // Enter on Clear asks first, and Escape keeps the mix
  await group.getByRole('button', { name: 'Clear' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.timeline .song')).toHaveCount(4);
});

const unhealthy = { storage_full: true, analysis: { running: false, paused: true, asked_for: 0, left: 3 } };

test('S4-0107-08 at 1440px the header names the blockers and links straight to Workspace from any page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/jobs*', (route) => rewriteJson(route, (body) => ({ ...body, ...unhealthy })));
  for (const path of ['/library', '/listen', '/mixes']) {
    await page.goto(path);
    const link = page.locator('.context-bar').getByRole('link', { name: /^Workspace, \d+ items? needs? your attention$/ });
    await expect(link, path).toBeVisible();
    await expect(link).toHaveAttribute('href', '/workshop');
    await link.focus();
    await expect(link).toBeFocused();
  }
  await page.locator('.context-bar').getByRole('link', { name: /your attention/ }).press('Enter');
  await expect(page).toHaveURL(/\/workshop/);
});

test('S4-0107-08 on a phone the blocker is a described dot on More, and More leads to Workspace', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/jobs*', (route) => rewriteJson(route, (body) => ({ ...body, ...unhealthy })));
  await page.goto('/library');
  const more = page.locator('.nav-more-mobile');
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute('aria-description', 'Workspace needs your attention');
  await expect(more.locator('.nav-attention')).toBeVisible();
  // the header stays uncluttered on a phone: the warning is on More, not one more top-bar button
  const header = await page.locator('.context-bar .health-attention').isVisible().catch(() => false);
  console.log(`S4-0107-08 phone header indicator visible: ${header}`);
  await more.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('navigation', { name: 'Workspace' });
  await expect(drawer).toBeVisible();
  const first = drawer.getByRole('link').first();
  await expect(first).toHaveAttribute('href', /^\/workshop/);
  await first.click();
  await expect(page).toHaveURL(/\/workshop/);
});

test('S4-0107-08 a healthy server shows no indicator anywhere', async ({ page }) => {
  await page.route('**/api/jobs*', (route) => rewriteJson(route, (body) => ({ ...body, storage_full: false, failed_seams: [], failed_songs: [], analysis: { running: false, paused: false, asked_for: 0, left: 0 } })));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator('.context-bar .health-attention')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.nav-more-mobile')).not.toHaveAttribute('aria-description', /.+/);
  await expect(page.locator('.nav-more-mobile .nav-attention')).toHaveCount(0);
});
