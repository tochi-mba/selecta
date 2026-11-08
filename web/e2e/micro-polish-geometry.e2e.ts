import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * Measured MP candidates: computed CSS and element boxes, never a human visual approval.
 * No real music, local paths or personal library metadata enter the artifact.
 */
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 620, height: 740 },
  { width: 760, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
  { width: 1280, height: 600 }, // short landscape
] as const;

const ROUTES = ['/mixes', '/library', '/listen', '/mix/current/edit'] as const;
const SELECTORS = [
  '.nav', '.context-bar', '.crumbs', '.context-actions', '.content', '.page',
  '.display', '.card', '.panel', '.song-row', '.song-actions', '.transport',
  '.strip', '.lyrics', '.mini', '.overlay-panel',
] as const;

type Geometry = {
  selector: string; box: { x: number; y: number; width: number; height: number };
  css: { margin: string; padding: string; gap: string; border: string;
    fontSize: string; lineHeight: string; display: string; position: string };
};

for (const theme of ['light', 'dark'] as const) {
  test(`computed micro-polish candidate matrix, ${theme}`, async ({ page, request }, info) => {
    await resetMix(request);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const observations: Array<{
      route: string; viewport: { width: number; height: number };
      documentWidth: number; geometry: Array<Geometry | null>;
    }> = [];
    await page.goto('/mixes');
    await page.evaluate((chosen) =>
      localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })),
    theme);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.locator('main#main')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const reading = await page.evaluate((selectors) => {
          const geometry = selectors.map((selector): Geometry | null => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) return null;
            const box = element.getBoundingClientRect();
            const css = getComputedStyle(element);
            return {
              selector,
              box: { x: box.x, y: box.y, width: box.width, height: box.height },
              css: {
                margin: css.margin, padding: css.padding, gap: css.gap, border: css.border,
                fontSize: css.fontSize, lineHeight: css.lineHeight, display: css.display,
                position: css.position,
              },
            };
          });
          return { documentWidth: document.documentElement.scrollWidth, geometry };
        }, [...SELECTORS]);
        expect(reading.documentWidth, `horizontal overflow on ${route} at ${viewport.width}px in ${theme}`)
          .toBeLessThanOrEqual(viewport.width + 1);
        observations.push({ route, viewport, ...reading });
      }
    }
    expect(observations).toHaveLength(VIEWPORTS.length * ROUTES.length);
    writeFileSync(info.outputPath(`micro-polish-geometry-${theme}.json`), JSON.stringify({
      status: 'candidate-not-independently-verified',
      sourceSha: process.env.GITHUB_SHA ?? null,
      capturedAt: new Date().toISOString(),
      browser: 'msedge',
      fixture: 'tests/e2e_server.py',
      theme,
      motion: 'still/reduced',
      required: VIEWPORTS.length * ROUTES.length,
      captured: observations.length,
      observations,
    }, null, 2));
  });
}

test('cards, panels and display type have one computed owner', async ({ page }) => {
  await page.goto('/mixes');
  const computed = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.left = '-9999px';
    document.body.append(probe);
    const values = (className: string) => {
      probe.className = className;
      const style = getComputedStyle(probe);
      return { padding: style.paddingTop, fontSize: Number.parseFloat(style.fontSize), lineHeight: Number.parseFloat(style.lineHeight) };
    };
    const result = { card: values('card'), panel: values('panel'), display: values('display'), small: values('display small') };
    probe.remove();
    return result;
  });
  expect(computed.card.padding).toBe('24px');
  expect(computed.panel.padding).toBe('24px');
  expect(computed.display.lineHeight / computed.display.fontSize).toBeCloseTo(1.08, 1);
  expect(computed.small.lineHeight / computed.small.fontSize).toBeCloseTo(1.12, 1);
});

test('mini-player and overlay geometry stay actionable on a narrow phone', async ({ page, request }, info) => {
  await resetMix(request);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.goto('/library');
  const mini = page.locator('.mini');
  await expect(mini).toBeVisible();
  const transport = mini.getByRole('button', { name: 'Pause' });
  const next = mini.getByRole('button', { name: 'Next song' });
  const bounds = await Promise.all([transport.boundingBox(), next.boundingBox()]);
  expect(bounds[0]?.width).toBeGreaterThanOrEqual(44);
  expect(bounds[1]?.width).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => { document.documentElement.dataset.keyboard = 'open'; });
  await expect(mini).toBeHidden();
  await page.evaluate(() => { delete document.documentElement.dataset.keyboard; });
  await expect(mini).toBeVisible();

  const opener = page.getByRole('button', { name: /^Details for / }).first();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(376);
  expect(box!.y + box!.height).toBeLessThanOrEqual(668);
  writeFileSync(info.outputPath('micro-polish-dynamic-phone.json'), JSON.stringify({
    status: 'candidate-not-independently-verified',
    sourceSha: process.env.GITHUB_SHA ?? null,
    viewport: { width: 375, height: 667 },
    fixture: 'tests/e2e_server.py',
    states: ['playing', 'route-handoff', 'keyboard-yield', 'song-details-overlay'],
    transport: bounds, dialog: box,
  }, null, 2));
});

test('mobile navigation remains keyboard reachable at extreme reflow', async ({ page }) => {
  // A 220px CSS viewport approximates high browser zoom on a narrow device.
  await page.setViewportSize({ width: 220, height: 740 });
  await page.goto('/mixes');
  const navigation = page.getByRole('navigation', { name: 'Main' });
  const list = navigation.locator('ul');
  const metrics = await list.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.width);
  const first = navigation.getByRole('link', { name: 'Listen' });
  const last = navigation.locator('.nav-more-mobile');
  await expect(first).toBeVisible();
  await expect(last).toBeVisible();
  for (const item of [first, last]) {
    const box = await item.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(64);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await last.focus();
  await expect(last).toBeFocused();
  expect(await list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test('editor keeps full bidirectional identity and exact song occurrence', async ({ page, request }) => {
  await resetMix(request);
  await page.goto('/mix/current/edit');
  const first = page.locator('.timeline .song').first();
  await expect(first.locator('.song-select')).toBeVisible();
  await expect(first.locator('.grip')).toHaveAttribute('aria-description', /Song occurrence 1 of \d+/);
  await expect(first.locator('.song-select')).toHaveAttribute('aria-description', /Song occurrence 1 of \d+/);
  const title = first.locator('.song-select b');
  await expect(title).toHaveAttribute('dir', 'auto');
  await expect(title).toHaveAttribute('title', /.+/);
  const artist = first.locator('.song-name > span').first();
  await expect(artist).toHaveAttribute('dir', 'auto');
});

test('Library selection boxes stay compact and aligned with song identity at every layout width', async ({ page, request }) => {
  await resetMix(request);
  for (const width of [320, 375, 760, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/library');
    const row = page.locator('.library-rows .song-row').first();
    await expect(row).toBeVisible();
    const checkbox = row.locator('.library-batch-check input[type="checkbox"]');
    const label = row.locator('.library-batch-check');
    const title = row.locator('.song-open');
    const boxes = await Promise.all([checkbox.boundingBox(), label.boundingBox(), title.boundingBox()]);
    expect(boxes.every(Boolean)).toBe(true);
    const [tick, target, name] = boxes as { x: number; y: number; width: number; height: number }[];
    expect(tick.width).toBeLessThanOrEqual(24);
    expect(tick.height).toBeLessThanOrEqual(24);
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(name.x, 'track name must be beside, not below, selection on ' + width).toBeGreaterThanOrEqual(target.x + target.width - 2);
    expect(Math.abs((name.y + name.height / 2) - (target.y + target.height / 2))).toBeLessThan(30);
    await checkbox.check();
    await expect(row).toHaveClass(/selected/);
    await expect(checkbox).toBeChecked();
  }
});

test('Listen display toggles never grow to the height of their neighbouring help text', async ({ page, request }) => {
  await resetMix(request);
  for (const width of [320, 375, 760, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/listen');
    const disclosure = page.locator('details.view-options');
    await expect(disclosure).toBeVisible();
    await disclosure.locator('summary').click();
    const panels = disclosure.locator('.listen-display-toggles');
    const countdown = panels.getByRole('button', { name: 'Beat countdown' });
    await expect(countdown).toBeVisible();
    const box = await countdown.boundingBox();
    expect(box, 'Beat countdown must have measurable geometry').not.toBeNull();
    expect(box!.height, 'oversized countdown toggle at ' + width + 'px').toBeLessThanOrEqual(70);
    expect(box!.width).toBeGreaterThanOrEqual(100);
    const intensity = disclosure.getByRole('group', { name: 'Visual intensity' });
    await expect(intensity.getByRole('button', { name: 'Standard visuals' })).toHaveAttribute('aria-pressed', 'true');
    const choices = await intensity.locator('button').evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height));
    expect(choices).toHaveLength(3);
    expect(choices.every((height) => height >= 44 && height <= 70)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
});
