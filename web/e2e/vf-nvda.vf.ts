// TEMPORARY headed probe for Claude's owner-delegated NVDA session (tag vf-). Deleted after the run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

const OUT = process.env.VF_OUT ?? 'vf-out';
mkdirSync(OUT, { recursive: true });
const STRESS_MIX = [8, 15, 18, 19, 20, 10, 17, 16];
const errors: Record<string, string> = {};
const notes: Record<string, string> = {};

async function mark(page: Page, words: string) {
  await page.evaluate((w) => {
    let n = document.getElementById('vf-marker');
    if (!n) { n = document.createElement('div'); n.id = 'vf-marker'; n.setAttribute('aria-live', 'assertive'); n.style.cssText = 'position:fixed;left:-9999px'; document.body.append(n); }
    n.textContent = '';
    setTimeout(() => { n!.textContent = w; }, 50);
  }, `Marker ${words}`);
  await page.waitForTimeout(2500);
}
async function settle(page: Page) {
  await page.locator('main#main:not([aria-busy="true"])').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
const press = async (page: Page, key: string, n = 1, wait = 1300) => { for (let i = 0; i < n; i += 1) { await page.keyboard.press(key); await page.waitForTimeout(wait); } };
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('role') ?? ''} ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 50)}` : 'none'; });
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { errors[name] = String(e).slice(0, 300); }
}

test('nvda session', async ({ page, request }) => {
  test.setTimeout(900_000);
  await resetMix(request, STRESS_MIX);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/mixes');
  await page.bringToFront();

  await step('nav', async () => {
    await page.goto('/library'); await settle(page);
    await mark(page, 'one primary navigation');
    await page.locator('nav [aria-current]').first().focus(); await page.waitForTimeout(1500);
    await press(page, 'Shift+Tab', 2); await press(page, 'Tab', 4);
    await page.goto('/workshop'); await settle(page);
    await mark(page, 'one b secondary navigation workspace');
    await page.locator('main [aria-current]').first().focus(); await page.waitForTimeout(1500);
    await press(page, 'Tab', 3);
    await press(page, 'Enter', 1, 3500);
  });
  await step('library', async () => {
    await page.goto('/library'); await settle(page);
    await mark(page, 'two library headings and filters');
    await page.getByRole('searchbox').first().focus(); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Needs attention' }).focus(); await page.waitForTimeout(1500);
    await press(page, 'Enter', 1, 3500);
    await press(page, 'Tab', 3);
    await mark(page, 'two b search status');
    await page.getByRole('button', { name: 'Everything' }).click(); await page.waitForTimeout(1000);
    await page.getByRole('searchbox').first().focus();
    await page.keyboard.type('moon', { delay: 120 }); await page.waitForTimeout(4000);
    await page.getByRole('searchbox').first().fill(''); await page.waitForTimeout(2000);
    await mark(page, 'two c song menu');
    await page.locator('main [aria-haspopup="menu"]').first().focus(); await page.waitForTimeout(1500);
    await press(page, 'Enter'); await press(page, 'ArrowDown', 2); await press(page, 'Escape');
    notes.menuFocusBack = await focused(page);
  });
  await step('export', async () => {
    await page.goto('/mix/current/edit'); await settle(page);
    await mark(page, 'three export dialog');
    await page.getByRole('button', { name: 'Download audio' }).focus(); await page.waitForTimeout(1200);
    await press(page, 'Enter', 1, 3000);
    await press(page, 'Tab', 5);
    await press(page, 'Escape', 1, 2000);
    notes.exportFocusBack = await focused(page);
    await page.goto('/workshop'); await settle(page);
    await mark(page, 'three b workspace exports');
    await page.getByRole('heading', { name: 'Exports' }).evaluate((n) => { (n.parentElement as HTMLElement).tabIndex = -1; (n.parentElement as HTMLElement).focus(); });
    await page.waitForTimeout(4000);
  });
  await step('composite', async () => {
    await page.goto('/mix/current/edit'); await settle(page);
    await mark(page, 'four view radio group');
    await page.getByRole('radio', { name: 'Arrange' }).focus(); await page.waitForTimeout(1500);
    await press(page, 'ArrowRight', 1, 2500); await press(page, 'ArrowLeft', 1, 2500);
    await mark(page, 'four b inspector tabs');
    await page.getByRole('button', { name: 'Change', exact: true }).first().click(); await page.waitForTimeout(2000);
    await page.getByRole('tab').first().focus(); await page.waitForTimeout(1500);
    await press(page, 'ArrowRight', 2); await press(page, 'Home');
    await mark(page, 'four c move a song');
    await page.locator('.song-select').nth(1).focus(); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^Move .* up|^Move up/ }).nth(1).focus().catch(() => {}); await page.waitForTimeout(1500);
    await press(page, 'Enter', 1, 3500);
    notes.afterMove = await focused(page);
    await resetMix(request, STRESS_MIX);
  });
  await step('overlays', async () => {
    await page.goto('/listen'); await settle(page);
    await mark(page, 'five requests drawer');
    await press(page, 'r', 1, 3000);
    await press(page, 'Tab', 2);
    await press(page, 'Escape', 1, 2000);
    await mark(page, 'five b command palette');
    await press(page, 'Control+k', 1, 2500);
    await page.keyboard.type('lib', { delay: 150 }); await page.waitForTimeout(2500);
    await press(page, 'ArrowDown', 2);
    await press(page, 'Escape', 1, 2000);
    await mark(page, 'five c song details');
    await page.goto('/library'); await settle(page);
    await page.getByRole('button', { name: /^Details for / }).first().focus(); await page.waitForTimeout(1000);
    await press(page, 'Enter', 1, 3500);
    await press(page, 'Escape', 1, 2000);
    notes.detailsFocusBack = await focused(page);
  });
  await step('study', async () => {
    await page.goto('/listening'); await settle(page);
    await mark(page, 'six listening study');
    await page.locator('main').evaluate((n) => { (n as HTMLElement).tabIndex = -1; (n as HTMLElement).focus(); });
    await page.waitForTimeout(9000);
  });
  await step('lucy', async () => {
    await page.goto('/mixes/lucy'); await settle(page);
    await mark(page, 'seven lucy send');
    const box = page.getByRole('textbox', { name: 'Message to Lucy' });
    await box.focus(); await page.waitForTimeout(1500);
    await page.keyboard.type('make me 6 songs', { delay: 60 });
    await press(page, 'Enter', 1, 15000);
    await mark(page, 'seven b lucy end');
  });
  await mark(page, 'end');
  writeFileSync(join(OUT, 'nvda-steps.json'), JSON.stringify({ errors, notes }, null, 2));
  expect(Object.keys(errors)).toEqual([]);
});
