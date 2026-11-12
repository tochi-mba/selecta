import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const OUT = resolve(process.cwd(), '../docs/verification/claude-checks/selecta-3-1');
export const STRESS_MIX = [8, 15, 18, 19, 20, 10, 17, 16];
export const ROUTES = [
  ['/', 'start'], ['/mixes', 'explore'], ['/mixes/mine', 'my-mixes'], ['/listen', 'listen'],
  ['/mix/current/edit', 'editor'], ['/library', 'library'], ['/discover', 'discover-words'],
  ['/discover/harmonic', 'discover-harmonic'], ['/workshop', 'workspace'], ['/workshop/sources', 'sources'],
  ['/workshop/diagnostics', 'diagnostics'], ['/listening', 'listening-study'],
] as const;

export function writeJson(sub: string, name: string, data: unknown) {
  mkdirSync(resolve(OUT, sub), { recursive: true });
  writeFileSync(resolve(OUT, sub, name), JSON.stringify(data, null, 1));
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((chosen) => {
    try {
      const saved = JSON.parse(localStorage.getItem('selecta.prefs') ?? '{}');
      localStorage.setItem('selecta.prefs', JSON.stringify({ ...saved, theme: chosen, motion: 'still' }));
    } catch { /* first paint without storage */ }
  }, theme);
}

export async function settle(page: Page) {
  const main = page.locator('main#main:not([aria-busy="true"])');
  await expect(main.locator('h1, h2').first()).toBeVisible();
  await expect(main.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Overflow, small targets and axe WCAG 2.2 AA findings for the page as it stands. */
export async function measure(page: Page) {
  const layout = await page.evaluate(() => {
    const room = window.innerWidth;
    const small: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, select, [role="tab"], [role="slider"], summary')) {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"], [inert]')) continue;
      if (box.width < 24 || box.height < 24) {
        const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
        if (!inline) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    const out = document.documentElement.scrollWidth > room
      ? [...document.querySelectorAll<HTMLElement>('body *')].filter((p) => p.getBoundingClientRect().right > room + 1 && getComputedStyle(p).position !== 'fixed').slice(-3).map((p) => `${p.tagName.toLowerCase()}.${p.className}`)
      : [];
    return { scrollWidth: document.documentElement.scrollWidth, room, sticking: out, smallTargets: small.slice(0, 12), smallCount: small.length };
  });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')), why: v.nodes[0]?.failureSummary?.slice(0, 200) }));
  return { ...layout, axe: violations };
}

export async function shot(page: Page, sub: string, name: string) {
  mkdirSync(resolve(OUT, sub), { recursive: true });
  const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 1600));
  const width = page.viewportSize()!.width;
  await page.screenshot({ path: resolve(OUT, sub, `${name}.png`), fullPage: true, clip: { x: 0, y: 0, width, height }, animations: 'disabled', caret: 'hide' });
}
