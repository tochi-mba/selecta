import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetMix } from '../e2e/helpers';
import { OUT, ROUTES, settle, STRESS_MIX, writeJson } from './shared';

test.beforeAll(async ({ request }) => { await resetMix(request, STRESS_MIX); });

const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  const style = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
    name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
    ring: style.outlineStyle !== 'none' && style.outlineWidth !== '0px' ? `outline ${style.outlineWidth}` : style.boxShadow !== 'none' ? 'box-shadow' : 'NONE',
    inView: box.bottom > 0 && box.top < innerHeight && box.width > 0,
  };
});

async function tabWalk(page: Page, stops = 45) {
  const seen = [];
  for (let i = 0; i < stops; i += 1) { await page.keyboard.press('Tab'); seen.push(await focused(page)); }
  return seen;
}

test('a11y routes: tree, landmarks, tab order, live regions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  mkdirSync(resolve(OUT, 'a11y'), { recursive: true });
  const report: Record<string, unknown> = {};
  for (const [path, id] of ROUTES) {
    try {
      await page.goto(path); await settle(page);
      writeFileSync(resolve(OUT, 'a11y', `tree-${id}.yaml`), await page.locator('body').ariaSnapshot());
      const facts = await page.evaluate(() => {
        const name = (el: Element) => (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim();
        const unnamed = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="slider"]')]
          .filter((el) => !el.closest('[aria-hidden="true"]') && !name(el) && !(el as HTMLInputElement).labels?.length && !el.getAttribute('aria-labelledby'))
          .map((el) => el.outerHTML.slice(0, 120));
        return {
          title: document.title,
          h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim()),
          headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName}:${h.textContent?.trim().slice(0, 40)}`).slice(0, 20),
          landmarks: [...document.querySelectorAll('main, nav, header, footer, aside, [role="region"][aria-label], [role="navigation"], [role="main"]')].map((l) => `${l.tagName.toLowerCase()}${l.getAttribute('aria-label') ? `[${l.getAttribute('aria-label')}]` : ''}`),
          currentPage: [...document.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent?.trim()),
          live: [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')].map((l) => `${l.getAttribute('role') ?? ''}/${l.getAttribute('aria-live') ?? ''}: ${l.textContent?.trim().slice(0, 80)}`),
          unnamed,
        };
      });
      await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => undefined);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const tabs = await tabWalk(page);
      report[id] = { ...facts, tabOrder: tabs, noRing: tabs.filter((t) => t && t.ring === 'NONE'), offscreen: tabs.filter((t) => t && !t.inView) };
    } catch (error) { report[id] = { error: String(error).slice(0, 300) }; }
  }
  writeJson('a11y', 'routes.json', report);
});

test('a11y overlays: focus in, Escape out, focus returns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const report: Record<string, unknown> = {};
  const overlay = async (id: string, path: string, open: () => Promise<void>, dialog: RegExp | string) => {
    try {
      await page.goto(path); await settle(page);
      await open();
      const box = page.getByRole('dialog', { name: dialog });
      await expect(box).toBeVisible();
      await page.waitForTimeout(300);
      const inside = await box.evaluate((d) => d.contains(document.activeElement));
      const tree = await box.ariaSnapshot();
      const trapped = [];
      for (let i = 0; i < 25; i += 1) { await page.keyboard.press('Tab'); trapped.push(await box.evaluate((d) => d.contains(document.activeElement))); }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const closed = !(await box.isVisible().catch(() => false));
      report[id] = { focusInside: inside, tabStaysInside: trapped.every(Boolean), escapeCloses: closed, focusAfterClose: await focused(page), tree };
    } catch (error) { report[id] = { error: String(error).slice(0, 300) }; }
  };
  const press = (name: RegExp | string) => async () => {
    const b = page.getByRole('button', { name }).first();
    await b.focus(); await page.keyboard.press('Enter');
  };
  await overlay('palette', '/library', async () => { await page.keyboard.press('Control+k'); }, 'Search and commands');
  await overlay('export', '/mix/current/edit', press('Download audio'), 'Save as an audio file');
  await overlay('shape', '/mixes', press('Customize'), 'Shape the next mix');
  await overlay('requests', '/listen', press(/^Requests/), /Requests/);
  await overlay('activity', '/listen', press(/^Activity/), 'Activity');

  // Playback: keyboard seek on the song slider, and Stage open/close with the keyboard.
  try {
    await page.goto('/listen'); await settle(page);
    const slider = page.getByRole('slider', { name: 'Where in the song' });
    const before = await slider.getAttribute('aria-valuetext');
    const disabledBefore = await slider.getAttribute('aria-disabled');
    await page.locator('.now .transport .primary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
    await slider.focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    const after = await slider.getAttribute('aria-valuetext');
    const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live], [role="status"]')].map((l) => l.textContent?.trim().slice(0, 100)).filter(Boolean));
    await page.keyboard.press('f');
    await page.waitForTimeout(400);
    const stageOpen = await page.locator('.now.stage').isVisible();
    const stageTree = stageOpen ? await page.locator('.now.stage').ariaSnapshot() : '';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const stageClosed = !(await page.locator('.now.stage').isVisible());
    report.playback = { before, after, disabledBefore, live, stageOpen, stageClosed, focusAfterStage: await focused(page), stageTree };
  } catch (error) { report.playback = { error: String(error).slice(0, 300) }; }

  // Editor: move a song with the keyboard; focus should stay on it and the new place be said.
  try {
    await page.goto('/mix/current/edit'); await settle(page);
    const down = page.getByRole('button', { name: /^Move .* down$/ }).first();
    const label = await down.getAttribute('aria-label');
    await down.focus(); await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live], [role="status"]')].map((l) => l.textContent?.trim().slice(0, 120)).filter(Boolean));
    report.editorMove = { pressed: label, focusAfter: await focused(page), live };
  } catch (error) { report.editorMove = { error: String(error).slice(0, 300) }; }
  writeJson('a11y', 'overlays.json', report);
});
