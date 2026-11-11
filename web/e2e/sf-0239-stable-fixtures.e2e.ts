import { writeFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * SF-0239-02: stable visual fixtures. Light and dark, a page with songs, no data, an error and a
 * load in progress, at a phone and a desktop size, each captured twice from a fresh load. The two
 * captures must be byte-for-byte the same, so a later difference is a real change, not noise.
 * These are review CANDIDATES, never golden baselines: nothing here judges how a screen looks.
 */

const FIXED_NOW = new Date('2026-11-10T12:00:00Z');
const SIZES = [
  { width: 320, height: 640 },
  { width: 1280, height: 800 },
] as const;

type State = { id: string; open: (page: Page) => Promise<void> };

const STATES: State[] = [
  {
    id: 'library-songs',
    open: async (page) => {
      await page.goto('/library');
      await expect(page.locator('.library-rows .song-row').first()).toBeVisible();
    },
  },
  {
    id: 'editor-no-songs',
    open: async (page) => {
      await page.request.post('/api/mix/clear');
      await page.goto('/mix/current/edit');
      await expect(page.locator('main#main')).toBeVisible();
      await expect(page.locator('main#main [aria-busy="true"]')).toHaveCount(0);
    },
  },
  {
    id: 'library-error',
    open: async (page) => {
      await page.route('**/api/library**', (route) => route.fulfill({ status: 500, json: { detail: 'fixture failure' } }));
      await page.goto('/library');
      await expect(page.getByText('Couldn’t load your library. Your songs are fine.')).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    id: 'library-loading',
    open: async (page) => {
      // the library never answers, so its placeholder stays on screen
      await page.route('**/api/library**', () => {});
      await page.goto('/library');
      await expect(page.getByRole('status', { name: 'Loading your songs' })).toHaveAttribute('data-revealed', 'true');
    },
  },
];

test.beforeEach(async ({ request }) => resetMix(request));

for (const size of SIZES) {
  test(`SF-0239-02 light, dark, songs, no data, error and loading capture identically twice at ${size.width}x${size.height}`, async ({ page, request }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await page.clock.setFixedTime(FIXED_NOW);
    const candidates: { id: string; theme: string; width: number; height: number; screenshot: string }[] = [];

    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/mixes');
      await page.evaluate((chosen) => {
        localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' }));
      }, theme);

      for (const state of STATES) {
        const shots: Buffer[] = [];
        for (let run = 0; run < 2; run += 1) {
          await resetMix(request);
          await state.open(page);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await page.evaluate(async () => { await document.fonts.ready; });
          await page.waitForTimeout(250);
          shots.push(await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }));
          await page.unrouteAll({ behavior: 'ignoreErrors' });
        }
        expect(shots[0].equals(shots[1]), `${state.id} in ${theme} at ${size.width}px differs between two captures`).toBe(true);
        const screenshot = `candidate-${size.width}x${size.height}-${state.id}-${theme}.png`;
        writeFileSync(info.outputPath(screenshot), shots[0]);
        candidates.push({ id: state.id, theme, ...size, screenshot });
      }
    }

    expect(candidates).toHaveLength(STATES.length * 2);
    writeFileSync(info.outputPath(`sf-0239-02-manifest-${size.width}x${size.height}.json`), JSON.stringify({
      status: 'candidate-not-independently-verified',
      fixture: 'tests/e2e_server.py',
      fixedTime: FIXED_NOW.toISOString(),
      motion: 'still/reduced',
      deterministic: 'each state captured twice from a fresh load and compared byte for byte',
      candidates,
    }, null, 2));
  });
}
