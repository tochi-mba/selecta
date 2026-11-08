import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

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
] as const;

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
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/mixes');
      await page.evaluate((chosen) => {
        localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' }));
      }, theme);

      const capture = async (id: string, path: string) => {
        await expect(page.locator('main#main')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // The exact accessible labels/roles/control state should not depend on the palette.
        // Record an equality hash, NOT a fabricated judgement of visual quality.
        await page.waitForTimeout(180);
        const semantics = await page.locator('main#main').evaluate((main) =>
          JSON.stringify([...main.querySelectorAll('button, input, select, textarea, summary, [role="tab"], a[href]')].map((node) => ({
            tag: node.tagName,
            role: node.getAttribute('role'),
            label: (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 120),
            pressed: node.getAttribute('aria-pressed'),
            selected: node.getAttribute('aria-selected'),
            checked: node.getAttribute('aria-checked'),
            disabled: (node as HTMLButtonElement).disabled === true,
          }))),
        );
        const semanticSha256 = hash(semantics);
        if (theme === 'light') expectedSemantics.set(id, semanticSha256);
        else expect(semanticSha256, `Theme changed semantic controls in ${id} at ${viewport.width}px`).toBe(expectedSemantics.get(id));
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
    writeFileSync(info.outputPath(`paired-manifest-${viewport.width}x${viewport.height}.json`),
      JSON.stringify({
        status: 'candidate-not-independently-verified',
        sourceSha: process.env.GITHUB_SHA ?? null,
        capturedAt: new Date().toISOString(),
        platform: info.project.name,
        browser: 'msedge',
        motion: 'still/reduced',
        fixture: 'tests/e2e_server.py',
        required, captured: candidates.length,
        candidates,
      }, null, 2),
    );
  });
}
