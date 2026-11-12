/* Temporary Claude recheck probes (vf-, 2026-11-12). Deleted after use. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetMix } from './helpers';

const OUT = process.env.VF_OUT ?? 'vf-out';
const found: Record<string, unknown> = {};

test.beforeEach(async ({ request }) => {
  await resetMix(request, [8, 15, 18, 19, 20, 10, 17, 16]);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

test('rechecks', async ({ browser, request }) => {
  mkdirSync(join(OUT, 'recheck'), { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 768, 1024, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto('/mix/current/edit');
      await expect(page.locator('.song-select').first()).toBeVisible();
      await page.waitForTimeout(500);
      found[`editor-${theme}-${width}`] = await page.locator('.timeline .song').first().evaluate((row) => {
        const w = (s: string) => Math.round(row.querySelector(s)?.getBoundingClientRect().width ?? -1);
        return { row: Math.round(row.getBoundingClientRect().width), name: w('.song-name'), actions: w('.song-actions') };
      });
      if (width !== 1024) await page.screenshot({ path: join(OUT, 'recheck', `editor-${theme}-${width}.png`), animations: 'disabled' });
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  // library toggles in light: pressed vs not
  await page.goto('/library');
  await expect(page.locator('main h1')).toBeVisible();
  found.toggles = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.library-density button, .library-layout button')).map((b) => {
    const s = getComputedStyle(b); return `${b.textContent} pressed=${b.getAttribute('aria-pressed')} bg=${s.backgroundColor} border=${s.borderTopColor} color=${s.color}`;
  }));
  found.panelBg = await page.evaluate(() => getComputedStyle(document.querySelector('main')!).backgroundColor);
  // comfortable vs compact row heights
  const heights = async () => page.locator('ul.library-rows > li').evaluateAll((rows) => rows.slice(0, 6).map((r) => Math.round(r.getBoundingClientRect().height)));
  found.comfortableRows = await heights();
  await page.getByRole('button', { name: 'Compact' }).click();
  await page.waitForTimeout(400);
  found.compactRows = await heights();
  await page.getByRole('button', { name: 'Comfortable' }).click();
  // export dialog axe detail
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Download audio' }).click();
  await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  found.exportAxe = violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => `${String(n.target)} ${n.html.slice(0, 160)}`) }));
  await page.keyboard.press('Escape');
  // Lucy conversation load: scroll and focus
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'VF probe' } })).json();
  await request.post(`/api/lucy/conversations/${made.id}/turns`, { data: { client_id: `vf-${Date.now()}`, text: 'make me 6 songs', expected_revision: null } });
  await expect.poll(async () => {
    const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
    return snap.messages.some((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete');
  }, { timeout: 60_000 }).toBe(true);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/mixes/lucy/${made.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    found[`lucy-${width}`] = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const skip = Array.from(document.querySelectorAll('a')).find((a) => /Skip to/.test(a.textContent ?? ''));
      const r = skip?.getBoundingClientRect();
      return { scrollY: Math.round(scrollY), active: el ? `${el.tagName} ${el.className} ${(el.textContent ?? '').trim().slice(0, 40)}` : 'none', skipVisible: r ? r.top >= 0 && r.top < innerHeight && r.width > 2 : false };
    });
    await page.screenshot({ path: join(OUT, 'recheck', `lucy-proposal-${width}.png`), animations: 'disabled' });
  }
  // phone radio labels in the editor
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/mix/current/edit');
  await expect(page.locator('.song-select').first()).toBeVisible();
  found.radioLabels = await page.getByRole('radio').evaluateAll((els) => els.map((el) => { const l = el.closest('label') ?? el; const r = l.getBoundingClientRect(); return `${l.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
  await context.close();
  writeFileSync(join(OUT, 'recheck.json'), JSON.stringify(found, null, 2));
});
