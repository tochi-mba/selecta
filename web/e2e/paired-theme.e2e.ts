import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { allRendered, resetMix } from './helpers';
import { assertNoPersonalData, provenance } from './pairedEvidence';

/**
 * Paired visual review CANDIDATES, not human-approved goldens. A pair uses the
 * same synthetic library, browser, viewport, route/state and motion preference.
 * The manifest is deliberately free of local music paths and user metadata.
 */
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 600 }, // short landscape
  { width: 320, height: 200 }, // 400% zoom of a 1280x800 window: the same CSS layout the zoomed page gets
] as const;

/** FP-0271-03: the required coverage denominator, and what is deliberately not captured here. */
const COVERAGE = {
  requiredWidths: [320, 375, 768, 1280, 1440, 1920],
  shortLandscape: '1280x600',
  zoom400: '320x200 (1280x800 at 400%)',
  exclusions: [
    '2560px: not paired; no stylesheet has a breakpoint above 761px, so it lays out as 1920px does',
    'Setup, Listen playing, Stage, Inspector, Studio, Requests, Details and failures: paired at 375x667 and 1280x800 by fp-0271-paired-states.e2e.ts',
  ],
};

/* FP-0271-05: provenance() and assertNoPersonalData() live in ./pairedEvidence, shared with fp-0271-paired-states.e2e.ts */

const ROUTES = [
  { path: '/', id: 'start-explore' },
  { path: '/mixes', id: 'explore' },
  { path: '/mixes/mine', id: 'my-mixes' },
  { path: '/listen', id: 'listen' },
  { path: '/mix/current/edit', id: 'editor' },
  { path: '/library', id: 'library' },
  { path: '/discover', id: 'discovery-words' },
  { path: '/discover/harmonic', id: 'discovery-harmonic' },
  { path: '/workshop', id: 'workspace' },
  { path: '/workshop/analysis', id: 'analysis' },
  { path: '/workshop/sources', id: 'sources' },
  { path: '/workshop/storage', id: 'storage-backups' },
  { path: '/workshop/learning', id: 'learning' },
  { path: '/workshop/diagnostics', id: 'diagnostics' },
  { path: '/listening', id: 'listening-study' },
] as const;

test.beforeEach(async ({ request }) => resetMix(request));

for (const viewport of VIEWPORTS) {
  test(`matched Light/Dark candidate states at ${viewport.width}x${viewport.height}`, async ({ page, request }, info) => {
    await page.setViewportSize(viewport);
    const candidates: Array<{
      id: string; path: string; theme: 'light' | 'dark'; width: number; height: number;
      semanticSha256: string; screenshot: string;
    }> = [];
    const expectedSemantics = new Map<string, string>();
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');

    for (const theme of ['light', 'dark'] as const) {
      await resetMix(request);
      // Capture both themes with every transition of the reset mix made, or the editor reads
      // "Rendering 2 of 3" in one theme and "3 of 3 ready" in the other.
      await allRendered(request);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/mixes');
      await page.evaluate((chosen) => {
        localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' }));
      }, theme);

      const capture = async (id: string, path: string) => {
        // Do not compare an actual page in one theme with Suspense's temporary
        // loading shell in the other. Capture only once the heading has mounted.
        const main = page.locator('main#main:not([aria-busy="true"])');
        await expect(main.locator('h1, h2').first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // A page's own data placeholders are not its controls: Word connections waits out a 200ms
        // search pause before it asks, so a reading taken while its placeholder shows records the
        // loading state in one theme and the loaded page in the other. Read once the data is in.
        await expect(main.locator('.skeleton')).toHaveCount(0);
        // Semantic controls must agree across light/dark. Poll for asynchronous
        // route data to settle, while preserving the strict equality assertion.
        await page.waitForTimeout(180);
        const semantics = () => main.evaluate((element) =>
          JSON.stringify([...element.querySelectorAll('button, input, select, textarea, summary, [role="tab"], a[href]')].map((node) => ({
            tag: node.tagName,
            role: node.getAttribute('role'),
            label: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
            pressed: node.getAttribute('aria-pressed'),
            selected: node.getAttribute('aria-selected'),
            checked: node.getAttribute('aria-checked'),
            disabled: (node as HTMLButtonElement).disabled === true,
          }))),
        );
        if (theme === 'dark') {
          await expect.poll(async () => hash(await semantics()), {
            timeout: 10_000,
            message: `Theme changed semantic controls in ${id} at ${viewport.width}px`,
          }).toBe(expectedSemantics.get(id));
        }
        const semanticSha256 = hash(await semantics());
        if (theme === 'light') expectedSemantics.set(id, semanticSha256);
        const screenshot = `candidate-${viewport.width}x${viewport.height}-${id}-${theme}.png`;
        await page.screenshot({
          path: info.outputPath(screenshot), fullPage: true,
          animations: 'disabled', caret: 'hide',
        });
        candidates.push({ id, path, theme, ...viewport, semanticSha256, screenshot });
      };

      for (const route of ROUTES) {
        await page.goto(route.path);
        await capture(route.id, route.path);
      }

      // Critical overlay states are captured at exactly the same viewport/data.
      await page.goto('/mix/current/edit');
      await page.getByRole('button', { name: 'Download audio' }).click();
      await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
      await capture('export-dialog', '/mix/current/edit');

      await page.goto('/mixes');
      await page.getByRole('button', { name: 'Customize' }).click();
      await expect(page.getByRole('dialog', { name: 'Shape the next mix' })).toBeVisible();
      await capture('shape-dialog', '/mixes');

      await page.goto('/library');
      await page.getByRole('checkbox', { name: /^Select recording/ }).first().check();
      await expect(page.getByRole('button', { name: 'Prioritize selected' })).toBeVisible();
      await capture('library-selection', '/library');

      await page.goto('/library?q=missing-fixture-song-xyz');
      await expect(page.getByText(/Nothing matches/)).toBeVisible();
      await capture('library-empty-search', '/library?q=missing-fixture-song-xyz');
    }

    const required = (ROUTES.length + 4) * 2;
    expect(candidates).toHaveLength(required);
    // CI emits reviewable pairs + a machine-readable provenance/coverage
    // denominator, without assuming screenshots are human-verified.
    const manifest = JSON.stringify({
        status: 'candidate-not-independently-verified',
        ...provenance(),
        capturedAt: new Date().toISOString(),
        platform: info.project.name,
        browser: 'msedge',
        motion: 'still/reduced',
        fixture: 'tests/e2e_server.py',
        required, captured: candidates.length,
        coverage: COVERAGE,
        candidates,
      }, null, 2);
    assertNoPersonalData(manifest);
    writeFileSync(info.outputPath(`paired-manifest-${viewport.width}x${viewport.height}.json`), manifest);
  });
}
