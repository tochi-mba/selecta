// wp6- scratch helpers for Claude's owner-delegated NVDA sessions. Deleted after the runs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const OUT = process.env.WP6_OUT ?? 'wp6-out';
mkdirSync(OUT, { recursive: true });

/** A spoken marker so the speech log can be split into steps. */
export async function mark(page: Page, words: string) {
  await page.evaluate((w) => {
    let n = document.getElementById('wp6-marker');
    if (!n) {
      n = document.createElement('div');
      n.id = 'wp6-marker';
      n.setAttribute('aria-live', 'assertive');
      n.style.cssText = 'position:fixed;left:-9999px';
      document.body.append(n);
    }
    n.textContent = '';
    setTimeout(() => { n!.textContent = w; }, 50);
  }, `Marker ${words}`);
  await page.waitForTimeout(2500);
}

export async function settle(page: Page) {
  await page.locator('main#main:not([aria-busy="true"])').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

export async function press(page: Page, key: string, n = 1, wait = 1300) {
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(wait);
  }
}

export const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return 'none';
  const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 60);
  return `${el.tagName} ${el.getAttribute('role') ?? ''} ${name}`;
});

/** Focus a block so NVDA reads its text (tabindex -1, never left in the page's tab order). */
export async function readBlock(page: Page, selector: string, wait = 5000) {
  await page.locator(selector).first().evaluate((n) => {
    (n as HTMLElement).tabIndex = -1;
    (n as HTMLElement).focus();
  });
  await page.waitForTimeout(wait);
}

export function recorder(name: string) {
  const errors: Record<string, string> = {};
  const notes: Record<string, unknown> = {};
  return {
    errors,
    notes,
    async step(label: string, fn: () => Promise<void>) {
      try { await fn(); } catch (e) { errors[label] = String(e).slice(0, 300); }
    },
    save() { writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ errors, notes }, null, 2)); },
  };
}

/** The first speech is kept only once NVDA announces the Edge window; give it time to. */
export async function wakeNvda(page: Page) {
  await page.bringToFront();
  await page.waitForTimeout(4000);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(2000);
}
