import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fixClock, FIXED_NOW } from './harness';
import { resetMix } from './helpers';

/**
 * S3-0075-01: deterministic review candidates for the states the other candidate specs leave out,
 * so docs/adr/s3-0075-coverage-map.json can point every captured state at a real image.
 *
 * This spec adds the connection-lost state over every inventory route that has one (the status
 * request is refused; the "Can't reach Selecta" banner shows over what was loaded) and the opening
 * state of the routes P0132 does not load (a draft in the editor, Lucy, an address that goes nowhere).
 *
 * Determinism is P0132's (polish-p0132-baselines.e2e.ts): the made-up library from tests/e2e_server.py,
 * a reset current mix, the page clock at harness.ts FIXED_NOW, reduced motion with animations disabled
 * and the caret hidden, nothing playing, and masks over canvas drawings, clock text and toasts.
 * Every image is a CANDIDATE, never a golden baseline: no toHaveScreenshot, and a manifest marked
 * candidate-not-independently-verified. A person approves the set in docs/adr/completion/visual-evidence.md.
 */

type Route = { id: string; path: string; fixtureId: string; states: string[] };
const ROOT = resolve(process.cwd(), process.cwd().replace(/\\/g, '/').endsWith('/web') ? '..' : '.');
const INVENTORY = JSON.parse(readFileSync(resolve(ROOT, 'docs/adr/mp-0272-surface-inventory.json'), 'utf8')) as { routes: Route[] };
// P0132 already loads these (helpers.ts PAGES); here only the rest get an opening candidate
const OPENING = ['route.draft', 'route.lucy', 'route.missing'];
const OFFLINE = INVENTORY.routes.filter((route) => route.states.includes('offline'));

const DISPLAYS = [{ width: 375, height: 812 }, { width: 1440, height: 900 }] as const;
const SCHEMES = ['light', 'dark'] as const;
const MASKS = ['canvas', 'time', '.tabular-time', '.mini-time', '.toast-stack'];

type Candidate = { surface: string; state: string; width: number; scheme: string; screenshot: string };

async function shot(page: Page, info: TestInfo, taken: Candidate[], entry: Omit<Candidate, 'screenshot'>) {
  const screenshot = `candidate-s3-0075-${entry.surface}--${entry.state}--${entry.width}-${entry.scheme}.png`;
  const image = await page.screenshot({
    fullPage: true, animations: 'disabled', caret: 'hide', mask: MASKS.map((selector) => page.locator(selector)),
  });
  writeFileSync(info.outputPath(screenshot), image);
  taken.push({ ...entry, screenshot });
}

function manifest(info: TestInfo, taken: Candidate[], part: string) {
  writeFileSync(info.outputPath(`s3-0075-01-manifest-${part}.json`), JSON.stringify({
    status: 'candidate-not-independently-verified',
    coverageMap: 'docs/adr/s3-0075-coverage-map.json',
    fixture: 'tests/e2e_server.py',
    fixedTime: FIXED_NOW.toISOString(),
    motion: 'reduced, animations disabled',
    masks: MASKS,
    candidates: taken,
  }, null, 2));
}

async function settle(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeAttached();
  await expect(page.locator('main').first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function pathFor(route: Route, request: Parameters<typeof resetMix>[0]) {
  if (route.fixtureId !== 'fx.draft.edit') return route.path;
  const made = await request.post('/api/drafts', { data: { name: 'A draft for the S3-0075 candidates', copy_current: true } });
  expect(made.ok()).toBe(true);
  return `/mixes/drafts/${(await made.json()).id}/edit`;
}

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await fixClock(page);
});

for (const display of DISPLAYS) {
  for (const scheme of SCHEMES) {
    const at = `${display.width}px in ${scheme}`;

    test(`S3-0075-01 opening candidates for the routes P0132 leaves out at ${at}`, async ({ page, request }, info) => {
      const taken: Candidate[] = [];
      await page.setViewportSize(display);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const route of INVENTORY.routes.filter((item) => OPENING.includes(item.id))) {
        await page.goto(await pathFor(route, request));
        await settle(page);
        if (route.id === 'route.missing') await expect(page.getByText(/nothing at this address/i)).toBeVisible();
        await shot(page, info, taken, { surface: route.id, state: route.states.includes('initial') ? 'initial' : 'idle', width: display.width, scheme });
      }
      expect(taken).toHaveLength(OPENING.length);
      manifest(info, taken, `${display.width}-${scheme}-opening`);
    });

    test(`S3-0075-01 connection-lost candidates over every route at ${at}`, async ({ page, request }, info) => {
      test.setTimeout(240_000);
      const taken: Candidate[] = [];
      await page.setViewportSize(display);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      for (const route of OFFLINE) {
        await page.goto(await pathFor(route, request));
        await settle(page);
        await page.route('**/api/status', (answer) => answer.abort('connectionrefused'));
        // the status poll runs on the page clock; move it on until the banner shows
        await expect(async () => {
          await page.clock.runFor(5_000);
          await expect(page.locator('.connection')).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 60_000 });
        await shot(page, info, taken, { surface: route.id, state: 'offline', width: display.width, scheme });
        await page.unroute('**/api/status');
      }
      expect(taken).toHaveLength(OFFLINE.length);
      manifest(info, taken, `${display.width}-${scheme}-offline`);
    });
  }
}
