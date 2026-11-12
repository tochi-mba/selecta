import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export const OUT = resolve(__dirname, '../../docs/verification/claude-checks/selecta-4-implementation-checklist');
export const LOG = resolve(process.env.VB_LOG ?? join(__dirname, 'vb-log.jsonl'));

export type Theme = 'light' | 'dark';
export const THEMES: Theme[] = ['light', 'dark'];
export const WIDTHS = [320, 768, 1440] as const;

/** Choose the theme the way a person does (saved preference) and match the OS to it. */
export async function useTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((chosen) => {
    try { localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })); } catch { /* ignore */ }
  }, theme);
}

export async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
  await page.waitForTimeout(250);
}

/** A PNG under OUT/<task>/<name>.png, of one element when given, else the viewport. */
export async function shot(page: Page, task: string, name: string, target?: Locator) {
  const path = join(OUT, task, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await settle(page);
  if (target) await target.screenshot({ path, animations: 'disabled' });
  else await page.screenshot({ path, animations: 'disabled' });
  return path;
}

export function record(entry: Record<string, unknown>) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}
