import AxeBuilder from '@axe-core/playwright';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PAGES, resetMix } from './helpers';
import { browserLine } from './perf-probe';

/**
 * S4-0110-10, the automated half: one environment-stamped log per run of what a machine can check
 * before a person's screen-reader session (docs/verification/at-session-log.md). For every page in
 * helpers.ts PAGES it records the axe WCAG 2.2 A/AA result and a keyboard walk: the first Tab stops,
 * each with its role and accessible name, and whether focus ever lands on something with no name or
 * disappears off the page. The log names commit, browser, axe version and viewport. It is a machine
 * reading, not WCAG compliance and not a screen-reader result: the log says so in its own `scope`.
 */
const TABS = 25;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type Stop = { role: string; name: string; visible: boolean };
type PageLog = { path: string; axe_violations: string[]; tab_stops: Stop[]; unnamed_stops: number; hidden_stops: number };

const commit = () => {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
};

test.beforeEach(async ({ request }) => resetMix(request));

test('S4-0110 automated accessibility log: axe and a keyboard walk on every page, stamped with the environment', async ({ page }, info) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pages: PageLog[] = [];
  let axeVersion = 'unknown';
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    axeVersion = results.testEngine.version;
    const axe = results.violations.flatMap((problem) => problem.nodes.map((node) => `${problem.id}: ${String(node.target)}`));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const stops: Stop[] = [];
    for (let tab = 0; tab < TABS; tab += 1) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return { role: 'body', name: '', visible: false };
        const labelledBy = element.getAttribute('aria-labelledby');
        const byId = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
        const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent ?? '' : '';
        const name = (element.getAttribute('aria-label') ?? (byId || label || element.textContent || element.getAttribute('title') || element.getAttribute('placeholder') || '')).trim().replace(/\s+/g, ' ').slice(0, 60);
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
          name,
          visible: box.width > 0 && box.height > 0 && style.visibility !== 'hidden',
        };
      }));
    }
    const real = stops.filter((stop) => stop.role !== 'body');
    pages.push({
      path,
      axe_violations: axe,
      tab_stops: stops,
      unnamed_stops: real.filter((stop) => !stop.name).length,
      hidden_stops: real.filter((stop) => !stop.visible).length,
    });
  }
  const log = {
    task: 'S4-0110-10',
    scope: 'automated axe and keyboard reading only; not WCAG 2.2 compliance and not a screen-reader session',
    status: 'candidate-not-independently-verified',
    commit: commit(),
    machine: await browserLine(page),
    axe: axeVersion,
    tags: TAGS,
    viewport: '1280x900',
    reduced_motion: true,
    fixture: 'tests/e2e_server.py made-up library, current mix reset',
    pages,
  };
  const file = info.outputPath('s4-0110-at-log.json');
  writeFileSync(file, JSON.stringify(log, null, 2));
  await info.attach('s4-0110-at-log.json', { path: file, contentType: 'application/json' });
  const totals = {
    pages: pages.length,
    axe_violations: pages.reduce((sum, row) => sum + row.axe_violations.length, 0),
    unnamed_stops: pages.reduce((sum, row) => sum + row.unnamed_stops, 0),
    hidden_stops: pages.reduce((sum, row) => sum + row.hidden_stops, 0),
  };
  console.log(`S4-0110-LOG ${JSON.stringify({ commit: log.commit, machine: log.machine, axe: log.axe, ...totals })}`);
  expect(pages.flatMap((row) => row.axe_violations.map((problem) => `${row.path}: ${problem}`)), 'axe WCAG 2.2 A/AA').toEqual([]);
  expect(pages.flatMap((row) => row.tab_stops.filter((stop) => stop.role !== 'body' && !stop.name).map((stop) => `${row.path}: ${stop.role}`)), 'a Tab stop with no name').toEqual([]);
  expect(pages.flatMap((row) => row.tab_stops.filter((stop) => stop.role !== 'body' && !stop.visible).map((stop) => `${row.path}: ${stop.role} ${stop.name}`)), 'focus on something that cannot be seen').toEqual([]);
});
