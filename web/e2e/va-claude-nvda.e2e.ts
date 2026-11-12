// TEMPORARY probe for Claude's owner-delegated NVDA session (tag va-). Deleted after the run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';

const OUT = process.env.VA_OUT ?? 'va-out';
mkdirSync(OUT, { recursive: true });
const STRESS_MIX = [8, 15, 18, 19, 20, 10, 17, 16];
const log: string[] = [];
const errors: Record<string, string> = {};

async function mark(page: Page, words: string) {
  log.push(words);
  await page.evaluate((w) => {
    let n = document.getElementById('va-marker');
    if (!n) { n = document.createElement('div'); n.id = 'va-marker'; n.setAttribute('aria-live', 'assertive'); n.style.cssText = 'position:fixed;left:-9999px'; document.body.append(n); }
    n.textContent = '';
    setTimeout(() => { n!.textContent = w; }, 50);
  }, `Marker ${words}`);
  await page.waitForTimeout(2500);
}
async function settle(page: Page) {
  await page.locator('main#main:not([aria-busy="true"])').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
async function readNode(page: Page, selector: string) {
  // NVDA speaks a focused generic element's content, in DOM reading order
  await page.locator(selector).first().evaluate((n) => { (n as HTMLElement).tabIndex = -1; (n as HTMLElement).focus(); });
  await page.waitForTimeout(3500);
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { errors[name] = String(e).slice(0, 300); }
}

test('nvda session', async ({ page, request }) => {
  test.setTimeout(900_000);
  await resetMix(request, STRESS_MIX);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/mixes');
  await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: 'light', motion: 'still' })));
  await page.bringToFront();

  await step('rows-edit', async () => {
    await page.goto('/mix/current/edit'); await settle(page);
    await mark(page, 'one editor row');
    const row = page.locator('.song-select').first().locator('xpath=ancestor::li[1]');
    await row.evaluate((n) => { (n as HTMLElement).tabIndex = -1; (n as HTMLElement).focus(); });
    await page.waitForTimeout(4000);
    await mark(page, 'one editor row tab walk');
    await page.locator('.song-select').first().focus();
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(1200); }
  });
  await step('rows-library', async () => {
    await page.goto('/library'); await settle(page);
    await mark(page, 'two library row');
    const row = page.getByRole('checkbox', { name: /^Select recording/ }).first().locator('xpath=ancestor::*[self::li or self::tr or @role="row"][1]');
    await row.evaluate((n) => { (n as HTMLElement).tabIndex = -1; (n as HTMLElement).focus(); });
    await page.waitForTimeout(4000);
  });
  await step('rows-listen', async () => {
    await page.goto('/listen'); await settle(page);
    await mark(page, 'three listen song');
    await readNode(page, '.now .now-song, .now header, .now h1, main h1');
    await page.locator('.now .transport .primary').focus(); await page.waitForTimeout(1500);
    await page.keyboard.press('Enter'); await page.waitForTimeout(5000);
    await mark(page, 'three b mini player');
    await page.goto('/library'); await settle(page);
    await readNode(page, 'aside.mini');
  });
  await step('rail', async () => {
    for (const path of ['/library', '/mix/current/edit', '/workshop']) {
      await page.goto(path); await settle(page);
      await mark(page, `four rail on ${path.replace(/\//g, ' ')}`);
      const current = page.locator('nav [aria-current]').first();
      await current.focus(); await page.waitForTimeout(2000);
      await page.keyboard.press('Tab'); await page.waitForTimeout(1500);
    }
  });
  await step('menu-tabs-tooltip', async () => {
    await page.goto('/library'); await settle(page);
    await mark(page, 'five menu');
    const trigger = page.locator('[aria-haspopup="menu"]').first();
    await trigger.focus(); await page.waitForTimeout(1500);
    await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
    await mark(page, 'five b tooltip');
    await page.locator('[data-tip]').first().focus(); await page.waitForTimeout(2000);
    await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
    await page.goto('/mix/current/edit'); await settle(page);
    await page.getByRole('button', { name: 'Change', exact: true }).first().click(); await page.waitForTimeout(1500);
    await mark(page, 'five c inspector tabs');
    await page.getByRole('tab').first().focus(); await page.waitForTimeout(1500);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  });
  await step('actions', async () => {
    await page.goto('/mix/current/edit'); await settle(page);
    await mark(page, 'six whole mix actions');
    await page.getByRole('button', { name: /Play from the top/ }).focus(); await page.waitForTimeout(1500);
    for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(1100); }
  });
  await step('problem', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20][i % 18]);
    await request.post('/api/mix/clear');
    for (const id of ids) await request.post('/api/mix/songs', { data: { song_id: id } });
    await page.route('**/api/mix', (route) => route.request().method() === 'GET' ? rewriteJson(route, (body) => { const m = body.mix; for (let i = 1; i < m.length; i++) if (m[i].seam) m[i].seam.state = { ...m[i].seam.state, status: i === 63 ? 'failed' : 'ready', error: i === 63 ? 'synthetic failure' : undefined }; return body; }) : route.continue());
    await page.goto('/mix/current/edit'); await settle(page);
    await mark(page, 'seven problem jump');
    const jump = page.getByRole('button', { name: /Jump to first problem/ });
    await jump.focus(); await page.waitForTimeout(1500);
    await page.keyboard.press('Enter'); await page.waitForTimeout(4000);
    writeFileSync(join(OUT, 'nvda-problem-focus.txt'), String(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').slice(0, 120))));
    await page.unroute('**/api/mix');
    await resetMix(request, STRESS_MIX);
  });
  await step('blocker', async () => {
    await page.route('**/api/jobs', (route) => rewriteJson(route, (body) => ({ ...body, storage_full: true, analysis: { ...body.analysis, paused: true, left: 5 } })));
    await page.goto('/mixes'); await settle(page);
    await mark(page, 'eight blocker on library');
    await page.getByRole('link', { name: 'Library' }).first().click();
    await page.waitForTimeout(12000);
    await mark(page, 'eight b attention link');
    await page.locator('.health-attention').focus(); await page.waitForTimeout(1500);
    await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
    await page.unroute('**/api/jobs');
  });
  await step('forced', async () => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/library'); await settle(page);
    await mark(page, 'nine forced colours library');
    const box = page.getByRole('checkbox', { name: /^Select recording/ }).first();
    await box.focus(); await page.waitForTimeout(1200);
    await page.keyboard.press('Space'); await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, 'nvda-forced-library.png') });
    await page.goto('/mix/current/edit'); await settle(page);
    await mark(page, 'nine b forced colours editor');
    await page.locator('.song-select').first().focus(); await page.waitForTimeout(1200);
    await page.keyboard.press('Enter'); await page.waitForTimeout(2000);
    await page.screenshot({ path: join(OUT, 'nvda-forced-edit.png') });
    await page.emulateMedia({ forcedColors: 'none' });
  });
  await mark(page, 'end');
  writeFileSync(join(OUT, 'nvda-steps.json'), JSON.stringify({ log, errors }, null, 2));
  expect(Object.keys(errors)).toEqual([]);
});
