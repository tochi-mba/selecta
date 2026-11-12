// TEMPORARY probe for Claude's owner-delegated verification (tag va-). Deleted after the run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { allRendered, resetMix } from './helpers';

const OUT = process.env.VA_OUT ?? 'va-out';
mkdirSync(OUT, { recursive: true });
const results: Record<string, unknown> = {};
const note = (key: string, value: unknown) => { results[key] = value; writeFileSync(join(OUT, `results-${test.info().title.split(' ')[0]}.json`), JSON.stringify(results, null, 2)); };
const STRESS_MIX = [8, 15, 18, 19, 20, 10, 17, 16];

async function setPrefs(page: Page, theme: 'light' | 'dark', extra: Record<string, unknown> = {}) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto('/mixes');
  await page.evaluate(([t, e]) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: t, motion: 'still', ...(e as object) })), [theme, extra] as const);
}
async function settle(page: Page) {
  await page.locator('main#main:not([aria-busy="true"])').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await expect(page.locator('main .skeleton')).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(400);
}
async function shot(page: Page, name: string, full = false) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: full, animations: 'disabled', caret: 'hide' });
  return path;
}
async function sheet(page: Page, name: string, files: string[], cols: number, cell: number) {
  const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="width:${cell}px"><figcaption>${f.split(/[\\/]/).pop()}</figcaption></figure>`).join('');
  const p = await page.context().newPage();
  await p.setViewportSize({ width: cols * (cell + 8), height: 400 });
  await p.setContent(`<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px;font:11px sans-serif}figure{margin:0}img{display:block;border:1px solid #000}</style>${imgs}`);
  await p.screenshot({ path: join(OUT, `sheet-${name}.png`), fullPage: true });
  await p.close();
}
async function play(page: Page) {
  await page.goto('/listen');
  const button = page.locator('.now .transport .primary');
  await button.click();
  await expect(button).toHaveText('Pause', { timeout: 60_000 });
}

test('matrix routes x widths x themes', async ({ page, request }) => {
  await resetMix(request, STRESS_MIX);
  await allRendered(request);
  const routes = [['mixes', '/mixes'], ['library', '/library'], ['edit', '/mix/current/edit'], ['workshop', '/workshop'], ['listen', '/listen']] as const;
  const widths = [[320, 640], [375, 667], [768, 1024], [1280, 800], [1440, 900]] as const;
  const overflow: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await setPrefs(page, theme);
    for (const [w, h] of widths) {
      await page.setViewportSize({ width: w, height: h });
      const files: string[] = [];
      for (const [id, path] of routes) {
        await page.goto(path);
        await settle(page);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (sw > 1) overflow.push(`${theme} ${w} ${id} +${sw}px`);
        files.push(await shot(page, `m-${theme}-${w}-${id}`));
      }
      await page.route('**/api/library?**', (r) => r.fulfill({ status: 500, json: { detail: 'synthetic failure' } }));
      await page.goto('/library');
      await page.waitForTimeout(2500);
      files.push(await shot(page, `m-${theme}-${w}-library-error`));
      await page.unroute('**/api/library?**');
      const cols = w <= 320 ? 6 : w <= 375 ? 6 : w <= 768 ? 3 : 2;
      const cell = w <= 375 ? w : w <= 768 ? 512 : 720;
      await sheet(page, `${theme}-${w}`, files, cols, cell);
    }
  }
  note('overflow', overflow);
});

test('states overlays gallery forced', async ({ page, request }) => {
  test.setTimeout(900_000);
  await resetMix(request, STRESS_MIX);
  await allRendered(request);
  const log: Record<string, unknown> = {};
  for (const theme of ['light', 'dark'] as const) {
    for (const [w, h] of [[1440, 900], [375, 667]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await setPrefs(page, theme);
      const files: string[] = [];
      const step = async (id: string, fn: () => Promise<void>, full = false) => {
        try { await fn(); await page.waitForTimeout(500); files.push(await shot(page, `s-${theme}-${w}-${id}`, full)); }
        catch (e) { log[`${theme}-${w}-${id}`] = String(e).slice(0, 300); }
      };
      await step('export-dialog', async () => { await page.goto('/mix/current/edit'); await settle(page); await page.getByRole('button', { name: 'Download audio' }).first().click(); await expect(page.getByRole('dialog')).toBeVisible(); });
      await step('shape-dialog', async () => { await page.goto('/mixes'); await settle(page); await page.getByRole('button', { name: 'Customize' }).first().click(); await expect(page.getByRole('dialog')).toBeVisible(); });
      await step('inspector', async () => { await page.goto('/mix/current/edit'); await settle(page); await page.getByRole('button', { name: 'Change', exact: true }).first().click(); await expect(page.locator('.edit-inspector, .overlay-sheet').first()).toBeVisible(); });
      await step('listen-playing', async () => { await play(page); await page.waitForTimeout(1500); });
      await step('listen-lyrics', async () => { await page.getByRole('button', { name: 'Lyrics focus' }).click(); await page.waitForTimeout(3000); });
      await step('library-mini', async () => { await page.goto('/library'); await settle(page); });
      await step('mymixes-playing', async () => { await page.goto('/mixes/mine'); await settle(page); });
      await step('menu-open', async () => { await page.goto('/library'); await settle(page); const m = page.locator('[aria-haspopup="menu"]').first(); await m.click(); await expect(page.getByRole('menu').first()).toBeVisible(); });
      await step('stage', async () => { await page.goto('/listen'); await settle(page); await page.locator('[data-stage-launcher]').evaluate((n) => { for (let u = n.parentElement; u; u = u.parentElement) if (u.tagName === 'DETAILS') (u as HTMLDetailsElement).open = true; }); await page.locator('[data-stage-launcher]').click(); await expect(page.locator('.stage-controls')).toBeVisible(); });
      await page.keyboard.press('Escape').catch(() => {});
      await step('mymixes-paused', async () => { await page.goto('/listen'); const b = page.locator('.now .transport .primary'); if ((await b.textContent()) === 'Pause') await b.click(); await page.goto('/mixes/mine'); await settle(page); });
      await step('editor-full', async () => { await page.goto('/mix/current/edit'); await settle(page); }, true);
      await step('focus-tab', async () => { await page.goto('/mix/current/edit'); await settle(page); for (let i = 0; i < 6; i++) await page.keyboard.press('Tab'); });
      await sheet(page, `states-${theme}-${w}`, files, w > 400 ? 2 : 6, w > 400 ? 720 : 375);
    }
  }
  // empty current mix and 2 / 20 song editor at 1440 both themes
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setPrefs(page, theme);
    const files: string[] = [];
    await request.post('/api/mix/clear');
    await page.goto('/mixes/mine'); await settle(page); files.push(await shot(page, `c-${theme}-mymixes-empty`));
    await resetMix(request, [1, 2]); await page.goto('/mix/current/edit'); await settle(page); files.push(await shot(page, `c-${theme}-edit-2`, true));
    await resetMix(request, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20, 3, 5]); await page.goto('/mix/current/edit'); await settle(page); files.push(await shot(page, `c-${theme}-edit-20`, true));
    await sheet(page, `counts-${theme}`, files.slice(0, 2), 2, 720);
  }
  await resetMix(request, STRESS_MIX);
  // gallery, comfortable / compact, both themes
  for (const theme of ['light', 'dark'] as const) for (const density of ['comfortable', 'compact'] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await setPrefs(page, theme, { density });
    await page.goto('/workshop/diagnostics'); await settle(page);
    try {
      await page.locator('summary', { hasText: 'Development component gallery' }).click();
      await page.getByRole('button', { name: 'Toggle selection' }).click();
      await page.getByRole('button', { name: 'Default' }).hover();
      await page.locator('.control-gallery').screenshot({ path: join(OUT, `g-${theme}-${density}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Primary', exact: true }).focus();
      await page.keyboard.press('Tab');
      await page.locator('.control-gallery section').first().screenshot({ path: join(OUT, `g-${theme}-${density}-focus.png`) });
      await page.getByRole('button', { name: 'Open dialog' }).click();
      await shot(page, `g-${theme}-${density}-dialog`);
      await page.keyboard.press('Escape');
    } catch (e) { log[`gallery-${theme}-${density}`] = String(e).slice(0, 300); }
  }
  // forced colours
  await page.setViewportSize({ width: 1280, height: 800 });
  await setPrefs(page, 'dark');
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  const fc: string[] = [];
  for (const [id, path] of [['library', '/library'], ['edit', '/mix/current/edit'], ['mixes', '/mixes']] as const) {
    await page.goto(path); await settle(page);
    if (id === 'library') await page.getByRole('checkbox', { name: /^Select recording/ }).first().check().catch(() => {});
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
    fc.push(await shot(page, `f-${id}`));
  }
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
  await page.goto('/mix/current/edit'); await settle(page); fc.push(await shot(page, 'f-edit-lightscheme'));
  await sheet(page, 'forced', fc, 2, 720);
  log.done = true;
  note('states', log);
});
