import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APIRequestContext, expect, Page } from '@playwright/test';

export const OUT = process.env.VE_OUT ?? 'C:/Users/tochi/AppData/Local/Temp/claude/3ec60e2294e4cf87/30c7424d-04ce-46d7-abd9-1ca76811fedf/scratchpad/ve/out';
export const STRESS_MIX = [8, 15, 18, 19, 20, 10, 17, 16];

export function out(...parts: string[]) {
  const path = join(OUT, ...parts);
  mkdirSync(join(path, '..'), { recursive: true });
  return path;
}

export function save(name: string, data: unknown) {
  writeFileSync(out(name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

export const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export async function resetStress(request: APIRequestContext, songs = STRESS_MIX) {
  await request.post('/api/mix/clear');
  for (const song of songs) await request.post('/api/mix/songs', { data: { song_id: song } });
}

export async function allRendered(request: APIRequestContext, timeout = 1_200_000) {
  await request.post('/api/mix/render');
  await expect.poll(async () => {
    const { mix } = await (await request.get('/api/mix')).json();
    return (mix as { seam: { state: { status: string } } | null }[]).slice(1)
      .filter((item) => item.seam?.state.status !== 'ready').length;
  }, { timeout, intervals: [3000] }).toBe(0);
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto('/mixes');
  await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
}

export async function settle(page: Page) {
  const main = page.locator('main#main:not([aria-busy="true"])');
  await expect(main.locator('h1, h2').first()).toBeVisible();
  await expect(main.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

export const ROUTES = [
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

/** Every control in a root that the centre of which is covered by something else. */
export const covered = (page: Page, selector: string) => page.evaluate((sel) => {
  const found: string[] = [];
  for (const node of document.querySelectorAll<HTMLElement>(sel)) {
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) continue;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (hit && !(hit === node || node.contains(hit) || hit.contains(node))) {
      found.push(`${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 40)} under ${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}`);
    }
  }
  return found;
}, selector);

export const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
