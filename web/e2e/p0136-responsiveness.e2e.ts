import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resetMix } from './helpers';
import { browserLine, installProbe, vitalsSince } from './perf-probe';
import { BUDGETS, LAB_KIND, overBudget, type Reading } from './vitals';

/**
 * P0136 (Polish) and SF-0235-02 (Flow): responsiveness budgets with their method. Each surface is
 * loaded fresh, given real interactions (keyboard and pointer), and read with the shared observers in
 * ./perf-probe (Event Timing, Layout Instability, largest contentful paint) and the arithmetic in
 * ./vitals (INP by interaction, CLS by session window). The report is a LAB result from one machine:
 * there is no field data for a local app, and the JSON says so. Method and results:
 * docs/adr/completion/performance.md.
 */

type Surface = { route: string; ready: (page: Page) => Promise<unknown>; act?: (page: Page) => Promise<unknown> };

const SURFACES: Surface[] = [
  {
    route: '/listen',
    ready: (page) => expect(page.getByRole('button', { name: /^(Play|Resume from)/ })).toBeVisible(),
    act: async (page) => {
      await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(page.getByRole('button', { name: /^(Play|Resume from)/ })).toBeVisible();
    },
  },
  {
    route: '/library',
    ready: (page) => expect(page.locator('.library-rows li').first()).toBeVisible(),
    act: async (page) => {
      const box = page.getByRole('searchbox', { name: 'Search your library' });
      await box.click();
      await box.pressSequentially('Paper', { delay: 60 });
      await expect(page.getByRole('button', { name: /^Details for Paper Moon/ })).toBeVisible();
      await box.fill('');
      await expect(page.locator('.library-rows li').nth(1)).toBeVisible();
    },
  },
  {
    route: '/mix/current/edit',
    ready: (page) => expect(page.locator('.timeline .song').first()).toBeVisible(),
    act: async (page) => {
      await page.getByRole('button', { name: 'Move Slow Tide up' }).click();
      await expect(page.locator('.song .song-name b').first()).toHaveText('Slow Tide');
      await page.getByRole('button', { name: 'Undo' }).first().click();
      await expect(page.locator('.song .song-name b').first()).toHaveText('Morning Light');
    },
  },
  { route: '/mixes/mine', ready: (page) => expect(page.locator('main h1').first()).toBeVisible() },
  { route: '/discover', ready: (page) => expect(page.locator('main h1').first()).toBeVisible() },
  { route: '/workshop', ready: (page) => expect(page.locator('main h1').first()).toBeVisible() },
];

test.beforeEach(async ({ request }) => resetMix(request));

test('P0136 / SF-0235-02 lab INP stays at most 200 ms and CLS at most 0.1 on each surface, reported as lab data', async ({ page }, info) => {
  await installProbe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const readings: Reading[] = [];
  for (const surface of SURFACES) {
    await page.goto(surface.route);
    await surface.ready(page);
    await page.waitForTimeout(500);
    // the same keyboard interactions everywhere: the command palette, then a few Tab presses
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await page.keyboard.press('Escape');
    for (let step = 0; step < 3; step += 1) await page.keyboard.press('Tab');
    if (surface.act) await surface.act(page);
    // let the last interaction's entries arrive (Event Timing reports after the next paint)
    await page.waitForTimeout(400);
    readings.push(await vitalsSince(page, 0, surface.route));
  }
  const report = {
    kind: LAB_KIND,
    budgets: BUDGETS,
    method: 'fresh load per surface at 1440x900; command palette, three Tab presses and the surface action; INP = slowest interaction (98th percentile rule over 50), CLS = largest session window, LCP = latest candidate; see docs/adr/completion/performance.md',
    machine: await browserLine(page),
    readings,
  };
  writeFileSync(info.outputPath('p0136-lab-vitals.json'), JSON.stringify(report, null, 2));
  await info.attach('p0136-lab-vitals', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  // every surface was really used, so an INP of 0 ms means every interaction was under 16 ms
  for (const reading of readings) expect(reading.inputs, `${reading.surface}: no input reached the page`).toBeGreaterThanOrEqual(4);
  expect(readings.flatMap(overBudget)).toEqual([]);
});
