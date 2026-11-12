import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { fixClock } from './harness';
import { resetMix } from './helpers';
import { browserLine } from './perf-probe';

/**
 * S4-0112-06: reviewed golden comparisons that never promote themselves. Every run captures each view
 * as a CANDIDATE with its fixture, browser, theme, viewport and commit, into the test's output folder.
 * A view is compared only when a named person has approved one of its candidates with
 * `python -m selecta.audit.golden_promote`, which copies it to docs/verification/goldens/s4-0112/
 * and records reviewer, date, device and SHA in approved.json there. Until then the view reports
 * "no approved golden" and nothing is compared. This spec only reads that folder. The comparison is
 * a pixel count in the same pinned Edge (`channel: 'msedge'`), not toHaveScreenshot, so the first
 * capture can never become the expected image by itself (tests/test_flow_screenshot_approval.py).
 */
const GOLDENS = join(fileURLToPath(new URL('../..', import.meta.url)), 'docs', 'verification', 'goldens', 's4-0112');
const FIXTURE = 'tests/e2e_server.py made-up library, current mix reset, clock at harness.ts FIXED_NOW';
// a pixel differs when any channel moves by more than this; a view fails over this share of pixels
const CHANNEL_TOLERANCE = 16;
const MAX_DIFFERENT_SHARE = 0.002;

const VIEWS = [
  { path: '/listen', name: 'listen' },
  { path: '/mixes', name: 'explore' },
  { path: '/mix/current/edit', name: 'editor' },
  { path: '/library', name: 'library' },
] as const;
const DISPLAYS = [
  { width: 375, height: 812 },
  { width: 1280, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

type Approval = { name: string; file: string; reviewer: string; date: string; device: string; sha: string; browser: string };

const approvals = (): Approval[] => {
  const file = join(GOLDENS, 'approved.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { approvals: Approval[] }).approvals;
};

const commit = () => {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
};

/** Pixels that differ between two PNGs, decoded and counted in the page. */
async function differentPixels(page: Page, one: Buffer, other: Buffer) {
  return page.evaluate(async ({ one, other, tolerance }) => {
    const decode = async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    };
    const [a, b] = await Promise.all([decode(one), decode(other)]);
    if (a.width !== b.width || a.height !== b.height) return { sameSize: false, different: a.width * a.height, total: a.width * a.height, size: `${a.width}x${a.height} against ${b.width}x${b.height}` };
    let different = 0;
    for (let at = 0; at < a.data.length; at += 4) {
      if (Math.abs(a.data[at] - b.data[at]) > tolerance || Math.abs(a.data[at + 1] - b.data[at + 1]) > tolerance
        || Math.abs(a.data[at + 2] - b.data[at + 2]) > tolerance || Math.abs(a.data[at + 3] - b.data[at + 3]) > tolerance) different += 1;
    }
    return { sameSize: true, different, total: a.width * a.height, size: `${a.width}x${a.height}` };
  }, { one: one.toString('base64'), other: other.toString('base64'), tolerance: CHANNEL_TOLERANCE });
}

test.beforeEach(async ({ request }) => resetMix(request));

for (const display of DISPLAYS) {
  for (const scheme of SCHEMES) {
    test(`S4-0112 golden comparison at ${display.width}px in ${scheme}: candidates always, comparisons only once approved`, async ({ page }, info) => {
      test.setTimeout(300_000);
      await fixClock(page);
      await page.setViewportSize(display);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const approved = approvals();
      const taken: Record<string, unknown>[] = [];
      const failures: string[] = [];
      const sha = commit();
      const browser = await browserLine(page);
      for (const view of VIEWS) {
        const name = `${view.name}-${display.width}-${scheme}`;
        await page.goto(view.path);
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
        await page.waitForTimeout(400);
        const image = await page.screenshot({
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          // live times, progress and audio drawings change between runs; they are not layout
          mask: [page.locator('canvas'), page.locator('time'), page.locator('.tabular-time'), page.locator('[role="progressbar"]'), page.locator('.toast-stack')],
        });
        const file = `candidate-s4-0112-${name}.png`;
        writeFileSync(info.outputPath(file), image);
        const golden = approved.find((entry) => entry.name === name);
        let comparison = 'no approved golden';
        if (golden && existsSync(join(GOLDENS, golden.file))) {
          const result = await differentPixels(page, image, readFileSync(join(GOLDENS, golden.file)));
          const share = result.different / result.total;
          comparison = result.sameSize ? `${result.different} of ${result.total} pixels differ` : `size changed: ${result.size}`;
          if (!result.sameSize || share > MAX_DIFFERENT_SHARE) failures.push(`${name}: ${comparison} (approved ${golden.date} by ${golden.reviewer} at ${golden.sha})`);
        } else if (golden) {
          failures.push(`${name}: approved.json names ${golden.file}, which is not in the goldens folder`);
        }
        taken.push({ name, file, path: view.path, width: display.width, height: display.height, theme: scheme, comparison, golden: golden ? { reviewer: golden.reviewer, date: golden.date, sha: golden.sha } : null });
      }
      const manifest = info.outputPath(`s4-0112-manifest-${display.width}-${scheme}.json`);
      writeFileSync(manifest, JSON.stringify({
        status: 'candidate-not-independently-verified',
        task: 'S4-0112-06',
        commit: sha,
        browser,
        fixture: FIXTURE,
        masks: ['canvas', 'time', '.tabular-time', '[role="progressbar"]', '.toast-stack'],
        tolerance: { channel: CHANNEL_TOLERANCE, max_different_share: MAX_DIFFERENT_SHARE },
        captures: taken,
      }, null, 2));
      await info.attach(`s4-0112-manifest-${display.width}-${scheme}.json`, { path: manifest, contentType: 'application/json' });
      console.log(`S4-0112-GOLDEN ${JSON.stringify({ width: display.width, scheme, commit: sha, compared: taken.filter((row) => row.golden).length, captured: taken.length, failures: failures.length })}`);
      expect(failures, 'an approved golden no longer matches').toEqual([]);
    });
  }
}
