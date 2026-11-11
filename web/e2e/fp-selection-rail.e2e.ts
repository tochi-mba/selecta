import { writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * FP-0267 (ADR-0267), in a real browser, list and card layouts, Light and Dark:
 *   FP-0267-01  records what the selection area shows with nothing selected against one selected
 *               (buttons, disabled buttons, height), with screenshots, as the measured baseline;
 *   FP-0267-02  the way in is a named button and a checkbox per row, reachable by keyboard;
 *   FP-0267-05  Clear selection removes the rail, keeps keyboard focus on the way back in,
 *               and changes no recording (no request other than reads is sent).
 * The JSON report is candidate evidence, not a timed novice/expert study.
 */

test.beforeEach(async ({ request }) => resetMix(request));

const area = (page: Page) => page.locator('section.library-batch').evaluate((node) => {
  const buttons = [...node.querySelectorAll('button')].filter((button) => button.getBoundingClientRect().width > 0);
  return {
    buttons: buttons.map((button) => button.textContent?.trim()),
    disabled: buttons.filter((button) => button.disabled).length,
    height: Math.round(node.getBoundingClientRect().height),
  };
});

test('the selection rail appears only for a real selection, and Clear keeps focus and changes nothing (FP-0267-01/02/05)', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const report: Record<string, unknown>[] = [];
  const writes: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`); });
  for (const theme of ['light', 'dark'] as const) {
    for (const layout of ['list', 'cards'] as const) {
      await page.goto('/mixes');
      await page.evaluate(([chosen, shape]) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still', libraryLayout: shape })), [theme, layout] as const);
      await page.goto('/library');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const boxes = page.getByRole('checkbox', { name: /^Select recording/ });
      await expect(boxes.first()).toBeVisible();
      if (layout === 'cards') await expect(page.locator('ul.library-cards')).toBeVisible();
      writes.length = 0;

      // zero: one named entry, a hint about the checkboxes, nothing disabled, no action rail
      const entry = page.getByRole('button', { name: 'Select up to 200 loaded songs' });
      await expect(entry).toBeEnabled();
      await expect(page.locator('.library-batch-actions')).toHaveCount(0);
      const zero = await area(page);
      expect(zero.buttons).toEqual(['Select up to 200 loaded songs']);
      expect(zero.disabled).toBe(0);
      await page.locator('section.library-batch').screenshot({ path: info.outputPath(`zero-${layout}-${theme}.png`) });

      // keyboard entry: Space on a row checkbox
      await boxes.nth(1).focus();
      await page.keyboard.press('Space');
      await expect(boxes.nth(1)).toBeChecked();
      await expect(page.locator('.library-batch-actions')).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: /^1 of \d+ loaded recordings selected \(limit 200\)/ })).toBeVisible();
      const one = await area(page);
      expect(one.buttons).toContain('Clear selection');
      await page.locator('section.library-batch').screenshot({ path: info.outputPath(`one-${layout}-${theme}.png`) });

      // Clear by keyboard: the rail goes, focus lands on the way back in, nothing was written
      await page.getByRole('button', { name: 'Clear selection' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.library-batch-actions')).toHaveCount(0);
      await expect(entry).toBeFocused();
      await expect(boxes.nth(1)).not.toBeChecked();
      expect(writes).toEqual([]);
      report.push({ theme, layout, zero, one, focusAfterClear: 'Select up to 200 loaded songs' });
    }
  }
  writeFileSync(info.outputPath('fp-0267-selection-area.json'), JSON.stringify({ status: 'candidate-not-independently-verified', states: report }, null, 2));
});
