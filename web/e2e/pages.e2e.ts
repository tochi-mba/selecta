import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PAGES, resetMix, stickingOut } from './helpers';

test.beforeEach(async ({ request }) => {
  // Pages can run in any shard order; never depend on another test's mix changes.
  await resetMix(request);
});

const WIDTHS = [
  [320, 568],
  [375, 812],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
  [3840, 2160],
];

test('nothing goes wider than the window, from the smallest phone to 4K', async ({ page }) => {
  const found: string[] = [];
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    for (const address of PAGES) {
      await page.goto(address);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.waitForTimeout(150);
      found.push(...(await stickingOut(page, `${address} at ${width}px`)));
    }
  }
  expect(found).toEqual([]);
});

test('nothing goes wider than the window in landscape, or zoomed in as far as browsers go', async ({ page }) => {
  const found: string[] = [];
  // 400% zoom on a 1280px window lays out as a 320px one, and 200% as a 640px one
  for (const [width, height] of [[812, 375], [640, 400], [320, 256]]) {
    await page.setViewportSize({ width, height });
    for (const address of PAGES) {
      await page.goto(address);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.waitForTimeout(100);
      found.push(...(await stickingOut(page, `${address} at ${width}x${height}`)));
    }
  }
  expect(found).toEqual([]);
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`every page passes the automatic accessibility checks in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const found: string[] = [];
    for (const [width, height] of [[1440, 900], [375, 812]]) {
      await page.setViewportSize({ width, height });
      for (const address of PAGES) {
        await page.goto(address);
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
        await page.waitForTimeout(400);
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        for (const problem of violations) {
          for (const node of problem.nodes) {
            found.push(`${address} at ${width}: ${problem.id}: ${String(node.target)} ${node.failureSummary?.split('\n')[1]?.trim() ?? ''}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
}

test('dialogs and drawers pass the automatic accessibility checks too', async ({ page }) => {
  const check = async (where: string) => {
    await page.waitForTimeout(300);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    return violations.flatMap((problem) => problem.nodes.map((node) => `${where}: ${problem.id}: ${String(node.target)}`));
  };
  const found: string[] = [];
  for (const [width, height] of [[1440, 900], [375, 812]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/library');
    await page.getByRole('button', { name: /^Details for Paper Moon/ }).click();
    await expect(page.getByRole('dialog', { name: 'Paper Moon' })).toBeVisible();
    found.push(...(await check(`song details at ${width}`)));

    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Download audio' }).click();
    await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
    found.push(...(await check(`export at ${width}`)));

    await page.goto('/mixes');
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    found.push(...(await check(`customize at ${width}`)));

    await page.goto('/listen');
    await page.keyboard.press('r');
    await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible();
    found.push(...(await check(`requests at ${width}`)));
  }
  expect(found).toEqual([]);
});

test('reloading any page stays on it', async ({ page }) => {
  for (const address of PAGES) {
    await page.goto(address);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(address);
    await expect(page.getByRole('heading', { name: 'There’s nothing at this address.' })).toHaveCount(0);
  }
});

test('Back and Forward go where they should', async ({ page }) => {
  await page.goto('/mixes');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/library$/);
  await nav.getByRole('link', { name: 'Workspace' }).click();
  await expect(page).toHaveURL(/\/workshop$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/\/mixes$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/library$/);
});

test('the Library’s filters are part of its address', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('searchbox', { name: 'Search your library' }).fill('Déjà');
  await expect(page).toHaveURL(/q=D/);
  await expect(page.getByText('Déjà Vu')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search your library' })).toHaveValue('Déjà');
  await expect(page.getByText('Déjà Vu')).toBeVisible();
  await expect(page.getByText('Morning Light')).toHaveCount(0);
});

test('addresses that go nowhere say so, and API mistakes aren’t dressed up as pages', async ({ page, request }) => {
  await page.goto('/mixes/drafts/99999/edit');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByText(/no longer|can’t find|isn’t there|gone/i).first()).toBeVisible();
  expect((await request.get('/api/nope')).status()).toBe(404);
  expect((await request.get('/assets/nope.js')).status()).toBe(404);
});

test('the page only ever talks to this computer', async ({ page }) => {
  const elsewhere: string[] = [];
  page.on('request', (sent) => {
    const url = new URL(sent.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'data:' && url.protocol !== 'blob:') elsewhere.push(sent.url());
  });
  for (const address of PAGES) {
    await page.goto(address);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  }
  expect(elsewhere).toEqual([]);
});

test('the app can be installed: its manifest and icons are all there', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).status()).toBe(200);
  }
});
