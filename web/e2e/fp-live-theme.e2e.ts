import { expect, Page, test } from '@playwright/test';
import { audioClock, resetMix, soundsRestarted, spyOnAudio } from './helpers';

/**
 * FP final polish: what a theme change may and may not touch, in a real browser.
 *   FP-0265-05/06  System follows the OS at runtime; an explicit Light/Dark never does.
 *   FP-0266-02/04  A theme change while music plays repaints the live spectrum in the new palette,
 *                  keeps the chosen style, the selected energy song and the audio exactly as they were.
 *   FP-0268-07     Explore card actions stay visible and reachable at 320px, 1440px and 400% zoom.
 */

test.beforeEach(async ({ request }) => resetMix(request));

const shown = (page: Page) => page.evaluate(() => ({
  attr: document.documentElement.dataset.theme ?? 'system',
  scheme: getComputedStyle(document.documentElement).colorScheme,
  bars: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((bar) => bar.content),
}));

async function choose(page: Page, theme: 'Light' | 'Dark' | 'Match this computer') {
  await page.locator('.theme-menu > button').first().click();
  await page.getByRole('menuitemradio', { name: theme }).click();
}

test('System follows the OS as it flips, and an explicit choice ignores it (FP-0265-05/06)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/mixes');
  await page.evaluate(() => localStorage.removeItem('selecta.prefs'));
  await page.reload();
  await expect(page.locator('main#main')).toBeVisible();
  expect((await shown(page)).scheme).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await shown(page)).scheme).toBe('light');
  expect((await shown(page)).attr).toBe('system');

  for (const [pick, scheme, bar] of [['Dark', 'dark', '#100f0c'], ['Light', 'light', '#f5f2e9']] as const) {
    await choose(page, pick);
    for (const os of ['light', 'dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: os });
      await page.waitForTimeout(100);
      expect(await shown(page)).toEqual({ attr: scheme, scheme, bars: [bar, bar] });
    }
  }
  await choose(page, 'Match this computer');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await shown(page)).scheme).toBe('dark');
  expect((await shown(page)).bars).toEqual(['#100f0c', '#f5f2e9']);
});

/** Mean luminance of the painted spectrum pixels: Dark paints bright lime (about 0.78), Light its dark olive
 * and green (about 0.36, the green --ok stop dominating). A gap between 0.45 and 0.55 tells the palettes apart. */
const paintLuminance = (page: Page) => page.locator('canvas.music-visualizer').evaluate((node) => {
  const canvas = node as HTMLCanvasElement;
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    total += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    count += 1;
  }
  return count ? total / count : -1;
});

test('a theme change while playing repaints the spectrum and leaves music, style and selection alone (FP-0265-07, FP-0266-02/04)', async ({ page }) => {
  await spyOnAudio(page);
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
  const dj = page.locator('details.view-options');
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) await dj.locator(':scope > summary').click();
  const style = page.getByRole('combobox', { name: 'Audio visualizer style' });
  await style.selectOption('bars');
  const started = await soundsRestarted(page);
  const title = await page.locator('.now h1, .now .display').first().innerText();

  for (const [pick, bright] of [['Dark', true], ['Light', false], ['Dark', true]] as const) {
    const clock = (await audioClock(page))[0];
    await choose(page, pick);
    // every painted pixel is in the new palette within a few frames, never the old one
    // (Playwright's poll has no toSatisfy, so poll the verdict)
    await expect.poll(async () => { const value = await paintLuminance(page); return value >= 0 && (bright ? value > 0.55 : value < 0.45); }, { message: `${pick} spectrum palette` })
      .toBe(true);
    await expect(style).toHaveValue('bars');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(await soundsRestarted(page)).toBe(started);
    await expect.poll(async () => (await audioClock(page))[0]).toBeGreaterThan(clock);
    expect(await page.locator('.now h1, .now .display').first().innerText()).toBe(title);
  }

  // hidden while the theme changes, then shown again: the first frame back is already in the new palette
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await choose(page, 'Light');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => { const value = await paintLuminance(page); return value >= 0 && value < 0.45; }, { message: 'first frame back is in the Light palette' }).toBe(true);
  expect(await soundsRestarted(page)).toBe(started);
});

test('a theme change keeps the measured energy, the chosen song and the seams in the Editor (FP-0266-02)', async ({ page }) => {
  await page.goto('/mix/current/edit');
  const toggle = page.getByRole('button', { name: 'Measured song energy' });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const selected = page.getByRole('button', { name: /song 3, energy/ });
  await selected.click();
  await expect(selected).toHaveAttribute('aria-current', 'true');
  const snapshot = () => page.evaluate(() => ({
    energy: [...document.querySelectorAll('.energy-overview-bar')].map((bar) => [
      bar.getAttribute('aria-label'), Math.round(bar.getBoundingClientRect().height), bar.getAttribute('aria-current')]),
    seams: [...document.querySelectorAll('main#main [aria-label*="transition" i], main#main .seam')].map((seam) =>
      (seam.getAttribute('aria-label') ?? seam.textContent ?? '').trim().replace(/\s+/g, ' ')),
  }));
  const before = await snapshot();
  expect(before.energy).toHaveLength(4);
  for (const pick of ['Light', 'Dark', 'Match this computer'] as const) {
    await choose(page, pick);
    expect(await snapshot()).toEqual(before);
  }
});

for (const view of [
  { name: '320px', width: 320, height: 640 },
  { name: '1440px', width: 1440, height: 900 },
  // 400% zoom of a 1280px window lays out at 320 CSS pixels with everything four times larger
  { name: '400% zoom', width: 1280, height: 800, zoom: 4 },
]) {
  test(`Explore card actions stay visible and reachable at ${view.name} in both themes (FP-0268-07)`, async ({ browser }) => {
    for (const theme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        viewport: { width: Math.round(view.width / (view.zoom ?? 1)), height: Math.round(view.height / (view.zoom ?? 1)) },
        deviceScaleFactor: view.zoom ?? 1,
      });
      const page = await context.newPage();
      await page.goto('/mixes');
      await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
      await page.reload();
      const cards = page.locator('article.vibe-card');
      await expect(cards.first()).toBeVisible();
      // the longest disclosure open too, so a long artist list is part of what has to fit
      await cards.first().locator('summary').click();
      const problems = await cards.evaluateAll((all) => {
        const out: string[] = [];
        const page = document.documentElement;
        if (page.scrollWidth > page.clientWidth + 1) out.push(`page scrolls sideways ${page.scrollWidth}>${page.clientWidth}`);
        for (const card of all) {
          const name = card.querySelector('h3')?.textContent ?? '?';
          const box = card.getBoundingClientRect();
          const buttons = [...card.querySelectorAll<HTMLButtonElement>('.card-actions button')];
          // an Action keeps its working label ("Building…") in the button, hidden, so read the shown one
          const label = (button: HTMLButtonElement) => (button.querySelector('.action-labels > span') ?? button).textContent?.trim();
          if (!buttons.some((button) => label(button) === 'Play')) out.push(`${name}: no Play`);
          for (const button of buttons) {
            const own = button.getBoundingClientRect();
            if (own.width < 24 || own.height < 24) out.push(`${name}: ${button.textContent} too small`);
            if (own.left < box.left - 1 || own.right > box.right + 1) out.push(`${name}: ${button.textContent} outside its card`);
            if (own.right > page.clientWidth + 1 || own.left < -1) out.push(`${name}: ${button.textContent} off screen`);
          }
          for (const text of card.querySelectorAll('h3, p, summary')) {
            if (text.scrollWidth > text.clientWidth + 1) out.push(`${name}: text overflows`);
          }
        }
        return out;
      });
      expect(problems, `${theme} ${view.name}`).toEqual([]);
      // keyboard reaches the first card's Play
      const play = cards.first().getByRole('button', { name: 'Play', exact: true });
      await play.focus();
      await expect(play).toBeFocused();
      await play.scrollIntoViewIfNeeded();
      await expect(play).toBeInViewport();
      await context.close();
    }
  });
}
