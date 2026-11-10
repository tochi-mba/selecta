import { expect, test, type Page } from '@playwright/test';
import { audioClock, resetMix, soundsStarted, spyOnAudio } from './helpers';

/**
 * ADR-0285 Stage, the fullscreen lyric view: gutters, lyric size, the quiet heading, the visualiser and
 * countdown, the way out, no-lyric states and reduced motion. Edge, muted, real stylesheet, synthetic
 * library in tests/e2e_server.py. Fullscreen itself is refused in headless Edge, so Stage fills the page,
 * as it does for anyone whose browser refuses. Candidates for an independent reviewer.
 */
const playButton = (page: Page) => page.locator('.now .transport .primary');
const SIZES = [[1280, 600], [1920, 1080], [3840, 1080], [768, 1024], [375, 812], [320, 568]] as const;
const CJK = '雨上がりの港で君を待ちながら静かに流れる夜の歌をずっと聴いていた長い一行';
const ARABIC = 'أغنية طويلة عن المطر والميناء والقمر والطريق إلى المدينة البعيدة في الليل';
const LONG = 'and this line goes on and on far longer than any line should, so it has to wrap across the stage';

async function stage(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/listen');
  await expect(page.locator('.lyrics')).toBeVisible();
  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Pause', { timeout: 30_000 });
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

/** Every line shown on Stage: whole, inside the window and not cut. */
const lyricFit = (page: Page) => page.evaluate(() => {
  const lines = [...document.querySelectorAll('.stage .lyrics p')].filter((line) => line.textContent?.trim());
  return {
    scroll: document.documentElement.scrollWidth,
    lines: lines.map((line) => {
      const box = line.getBoundingClientRect();
      return { text: line.textContent!.slice(0, 24), left: box.left, right: box.right, top: box.top, bottom: box.bottom, cut: line.scrollWidth > line.clientWidth + 1, size: parseFloat(getComputedStyle(line).fontSize), direction: getComputedStyle(line).direction, sung: line.classList.contains('sung') };
    }),
  };
});

async function withLines(page: Page, lines: string[] | null, status = 'synced') {
  await page.route('**/api/songs/*', async (route) => {
    if (route.request().method() !== 'GET' || /\/audio|\/peaks/.test(route.request().url())) return route.fallback();
    const answer = await route.fetch();
    const body = await answer.json();
    const timed = lines === null ? [] : lines.map((text, index) => ({ start: index * 2, end: index * 2 + 2, text }));
    await route.fulfill({ response: answer, json: { ...body, lines: timed, lyric_status: status } });
  });
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await spyOnAudio(page);
  await resetMix(request);
});

test('MP-0285-01 short, wide and tall windows show the whole lyric composition with even gutters', async ({ page }) => {
  for (const [width, height] of SIZES) {
    await stage(page, width, height);
    const fit = await lyricFit(page);
    const where = `${width}x${height}`;
    expect(fit.scroll, `${where}: sideways scroll`).toBeLessThanOrEqual(width);
    expect(fit.lines.length, `${where}: lyric lines`).toBeGreaterThan(0);
    for (const line of fit.lines) {
      expect(line.left, `${where}: "${line.text}" cut at the left`).toBeGreaterThanOrEqual(0);
      expect(line.right, `${where}: "${line.text}" cut at the right`).toBeLessThanOrEqual(width);
      expect(line.cut, `${where}: "${line.text}" clipped`).toBe(false);
    }
    const sung = fit.lines.find((line) => line.sung) ?? fit.lines[0];
    expect(sung.top, `${where}: current line above the fold`).toBeGreaterThanOrEqual(0);
    expect(sung.bottom, `${where}: current line below the fold`).toBeLessThanOrEqual(height);
    const gutters = await page.locator('main.stage').evaluate((main) => {
      const style = getComputedStyle(main);
      return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
    });
    expect(Math.abs(gutters[0] - gutters[1]), `${where}: gutters even`).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  }
});

test('MP-0285-02 the active lyric stays large and whole for long, CJK and right-to-left lines', async ({ page }) => {
  for (const [name, text] of [['long', LONG], ['CJK', CJK], ['Arabic', ARABIC]] as const) {
    await page.unroute('**/api/songs/*');
    await withLines(page, Array.from({ length: 60 }, () => text));
    for (const [width, height] of [[1280, 720], [375, 812]] as const) {
      await stage(page, width, height);
      await expect(page.locator('.stage .lyrics .sung')).toBeVisible();
      const fit = await lyricFit(page);
      const sung = fit.lines.find((line) => line.sung)!;
      const where = `${name} at ${width}px`;
      expect(sung.size, `${where}: lyric size`).toBeGreaterThanOrEqual(width < 600 ? 28 : 38);
      expect(sung.right, `${where}: past the edge`).toBeLessThanOrEqual(width);
      expect(sung.cut, `${where}: clipped`).toBe(false);
      if (name === 'Arabic') expect(sung.direction, `${where}: right to left`).toBe('rtl');
      await page.keyboard.press('Escape');
    }
  }
});

test('MP-0285-03 the song heading on Stage supports the lyrics rather than competing', async ({ page }) => {
  for (const [width, height] of [[1280, 720], [375, 812]] as const) {
    await stage(page, width, height);
    await expect(page.locator('.stage .lyrics .sung')).toBeVisible();
    const sizes = await page.evaluate(() => {
      const size = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
      return { title: size('.stage .track-title'), artist: size('.stage .artist'), sung: size('.stage .lyrics .sung') };
    });
    expect(sizes.title, `${width}px: title smaller than the lyric`).toBeLessThan(sizes.sung * 0.75);
    expect(sizes.artist, `${width}px: artist no bigger than the title`).toBeLessThanOrEqual(sizes.title);
    await page.keyboard.press('Escape');
  }
});

test('MP-0285-04 the visualiser and countdown stay smaller than the lyrics and keep their place', async ({ page }) => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [375, 812]] as const) {
    await stage(page, width, height);
    const read = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const order = [...document.querySelectorAll('.stage .listen-identity, .stage .music-visualizer, .stage .handoff, .stage .lyrics')].map((element) => [element.className.split(' ')[0], element.getBoundingClientRect().top]);
      return { canvas: box('.stage .music-visualizer'), handoff: box('.stage .handoff'), lyrics: box('.stage .lyrics'), order, countdown: document.querySelector('.stage .countdown-number strong') ? parseFloat(getComputedStyle(document.querySelector('.stage .countdown-number strong')!).fontSize) : null, sung: parseFloat(getComputedStyle(document.querySelector('.stage .lyrics p')!).fontSize) };
    });
    const where = `${width}x${height}`;
    if (read.canvas) expect(read.canvas.height, `${where}: visualiser height`).toBeLessThanOrEqual(height * 0.25 + 1);
    const tops = read.order.map(([, top]) => top as number);
    expect([...tops].sort((a, b) => a - b), `${where}: heading, visualiser, countdown, lyrics`).toEqual(tops);
    expect(read.lyrics!.height, `${where}: the lyrics get the most room`).toBeGreaterThan(Math.max(read.canvas?.height ?? 0, read.handoff?.height ?? 0) * 0.8);
    await page.keyboard.press('Escape');
  }
});

test('MP-0285-05 Escape, F and a tap on Exit all leave Stage, focus comes back, and the music goes on', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await spyOnAudio(page);
  await stage(page, 375, 812);
  const started = await soundsStarted(page);
  const exit = page.getByRole('button', { name: 'Exit fullscreen' });
  await expect(exit).toBeVisible();
  const box = (await exit.boundingBox())!;
  expect(box.height, 'exit target').toBeGreaterThanOrEqual(44);
  expect(box.x + box.width, 'exit on screen').toBeLessThanOrEqual(375);
  expect(box.y + box.height, 'exit on screen').toBeLessThanOrEqual(812);
  await exit.tap();
  await expect(page.locator('.now.stage')).toHaveCount(0);
  await expect(playButton(page)).toHaveText('Pause');
  // keyboard: the launcher opens it, Escape closes it and focus goes back to the launcher
  const dj = page.locator('details.view-options');
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) await dj.locator(':scope > summary').click();
  const launcher = page.getByRole('button', { name: 'Fullscreen lyrics' });
  await launcher.focus();
  await launcher.press('Enter');
  await expect(page.locator('.now.stage')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.now.stage')).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toHaveCount(0);
  expect(await soundsStarted(page), 'nothing restarted').toBe(started);
  await context.close();
});

test('MP-0285-06 loading, instrumental, untimed and unavailable lyrics each say so honestly on Stage', async ({ page }) => {
  for (const [status, words] of [['instrumental', /Instrumental/], ['plain', /aren’t timed/], ['failed', /didn’t work/], [null, /haven’t been looked up/]] as const) {
    await page.unroute('**/api/songs/*');
    await withLines(page, null, status as string);
    await stage(page, 1280, 720);
    const fallback = page.locator('.stage .lyrics.quiet p');
    await expect(fallback).toHaveText(words);
    const box = (await fallback.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    await page.keyboard.press('Escape');
  }
  await page.unroute('**/api/songs/*');
  // still loading: a labelled placeholder, not invented lines
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/songs/*', async (route) => {
    if (route.request().method() !== 'GET' || /\/audio|\/peaks/.test(route.request().url())) return route.fallback();
    await held;
    await route.fallback();
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/listen');
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toBeVisible();
  await expect(page.locator('.stage [aria-label="Loading this song"], .stage .skeleton').first()).toBeVisible();
  await expect(page.locator('.stage .lyrics .sung')).toHaveCount(0);
  release();
  // unavailable: the song detail cannot be read at all
  await page.unroute('**/api/songs/*');
  await page.route('**/api/songs/*', (route) => (route.request().method() === 'GET' && !/\/audio|\/peaks/.test(route.request().url()) ? route.fulfill({ status: 503, json: { detail: 'down' } }) : route.fallback()));
  await page.goto('/listen');
  await page.keyboard.press('f');
  await expect(page.locator('.stage .problem, .stage [role="alert"]').first()).toContainText(/Couldn’t load lyrics/);
});

for (const how of ['the computer asks', 'Still is chosen in Selecta'] as const) {
  test(`MP-0285-07 when ${how}, Stage graphics hold still while the lyric and clock keep time`, async ({ page }) => {
    if (how === 'Still is chosen in Selecta') {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(() => localStorage.setItem('selecta.prefs', JSON.stringify({ motion: 'still' })));
    }
    await stage(page, 1280, 720);
    const still = await page.evaluate(async () => {
      const canvas = document.querySelector('.stage canvas.music-visualizer') as HTMLCanvasElement | null;
      const first = canvas?.toDataURL() ?? '';
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return first === (canvas?.toDataURL() ?? '');
    });
    expect(still, 'visualiser holds still').toBe(true);
    // music timing goes on: the clock moves and the lyric follows it
    const clock = (await audioClock(page))[0];
    const line = await page.locator('.stage .lyrics').textContent();
    await expect.poll(async () => (await audioClock(page))[0], { timeout: 20_000 }).toBeGreaterThan(clock + 4);
    await expect.poll(() => page.locator('.stage .lyrics').textContent(), { timeout: 15_000 }).not.toBe(line);
  });
}
