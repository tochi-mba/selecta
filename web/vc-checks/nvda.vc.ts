import { expect, test, type Page } from '@playwright/test';
import { resetMix } from '../e2e/helpers';
import { settle, STRESS_MIX } from './shared';

/** Headed Edge under real NVDA. Each step is preceded by an assertive marker so the speech log can be split. */
async function mark(page: Page, name: string) {
  await page.evaluate((text) => {
    let el = document.getElementById('vc-marker');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vc-marker';
      el.setAttribute('aria-live', 'assertive');
      el.setAttribute('style', 'position:fixed;left:-9999px;top:0');
      document.body.appendChild(el);
    }
    el.textContent = `MARKER ${text}`;
  }, name);
  await page.waitForTimeout(1500);
}
const wait = (page: Page, ms = 1200) => page.waitForTimeout(ms);
async function keys(page: Page, key: string, times = 1, ms = 900) {
  for (let i = 0; i < times; i += 1) { await page.keyboard.press(key); await wait(page, ms); }
}

test('nvda session', async ({ page, request }) => {
  test.skip(process.env.VC_NVDA !== '1', 'runs only under nvda_run.ps1');
  test.setTimeout(900_000);
  await resetMix(request, STRESS_MIX);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.bringToFront();

  // Route pass: headings by NVDA browse-mode "h" on each core route.
  for (const path of ['/listen', '/mixes', '/mix/current/edit', '/library', '/workshop', '/discover/harmonic', '/listening']) {
    await page.goto(path); await settle(page); await page.bringToFront();
    await mark(page, `route ${path} headings`);
    await keys(page, 'h', 5, 1100);
    await mark(page, `route ${path} tab`);
    await keys(page, 'Tab', 10, 800);
  }

  // Overlays: palette, export dialog, requests drawer; Escape and focus return.
  await page.goto('/library'); await settle(page);
  await mark(page, 'palette open');
  await page.keyboard.press('Control+k'); await wait(page, 2500);
  await page.keyboard.type('mix'); await wait(page, 2000);
  await keys(page, 'ArrowDown', 2, 1200);
  await mark(page, 'palette escape');
  await keys(page, 'Escape', 1, 2500);

  await page.goto('/mix/current/edit'); await settle(page);
  await page.getByRole('button', { name: 'Download audio' }).focus();
  await mark(page, 'export open');
  await keys(page, 'Enter', 1, 3000);
  await keys(page, 'Tab', 4, 1100);
  await mark(page, 'export escape');
  await keys(page, 'Escape', 1, 2500);

  // Editor: move a song down by keyboard; the new place should be announced once.
  await page.getByRole('button', { name: /^Move .* down$/ }).first().focus();
  await mark(page, 'editor move');
  await keys(page, 'Enter', 1, 4000);

  // Playback: play, song announced once; seek with arrows; Stage open and Escape.
  await page.goto('/listen'); await settle(page);
  await page.locator('.now .transport .primary').focus();
  await mark(page, 'play');
  await keys(page, 'Enter', 1, 8000);
  await page.getByRole('slider', { name: 'Where in the song' }).focus();
  await mark(page, 'seek');
  await keys(page, 'ArrowRight', 3, 1200);
  await mark(page, 'stage');
  await page.keyboard.press('f'); await wait(page, 3000);
  await mark(page, 'stage escape');
  await keys(page, 'Escape', 1, 3000);
  await mark(page, 'quiet 15s while playing');
  await wait(page, 15000);

  // Requests drawer by keyboard.
  await page.getByRole('button', { name: /^Requests/ }).first().focus();
  await mark(page, 'requests open');
  await keys(page, 'Enter', 1, 3000);
  await page.keyboard.type('Same'); await wait(page, 3000);
  await keys(page, 'Tab', 3, 1100);
  await mark(page, 'requests escape');
  await keys(page, 'Escape', 1, 2500);
  await mark(page, 'end');
  expect(true).toBe(true);
});
