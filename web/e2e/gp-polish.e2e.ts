import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * Gap polish (ADR-0248 and ADR-0249), measured in Edge on the real stylesheet: music title roles
 * and fit, the fixed title slot that keeps Play/Pause and the seek bar still as songs change, and
 * the Listen transport staying put while display panels open and close. Every name is invented and
 * only renamed in the JSON the page reads; nothing on disk changes.
 */
const SHORT = 'Home';
const LONG = 'The Long Way Home Through The City Lights At Night (Extended Club Mix) feat. Somebody Famous';
const MEDIUM = 'Midnight Harbour Lights (Radio Edit)';
const EMOJI = 'Sunrise 🌅🎶 Over The Bay 👩🏽‍🎤 (Sunrise 🌅 Club Edit) 🇯🇵';
const MIXED = 'Night Drive לילה ארוך (Extended) עם חברים';
const NAMES: Record<number, { title: string; artist: string }> = {
  1: { title: SHORT, artist: 'Short Artist' },
  2: { title: LONG, artist: 'An Ensemble With A Long Name' },
  3: { title: MEDIUM, artist: 'Velvet Static' },
  9: { title: EMOJI, artist: 'Ñandú & Zoë 🎧' },
  10: { title: MIXED, artist: 'Duo מעורב' },
};

async function useNames(page: Page) {
  await page.route(/\/api\/(mix|library|songs\/\d+)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    if (!(response.headers()['content-type'] ?? '').includes('json')) return route.fulfill({ response });
    const rename = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rename);
      if (!value || typeof value !== 'object') return value;
      const record = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, rename(inner)]));
      const id = Number(record.song_id ?? record.id);
      if ('title' in record && 'artist' in record && NAMES[id]) Object.assign(record, NAMES[id]);
      return record;
    };
    await route.fulfill({ response, json: rename(await response.json()) });
  });
}

type Box = { x: number; y: number; width: number; height: number };
const round = (box: Box | null) => box && { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };

async function listen(page: Page, title: string) {
  await page.goto('/listen');
  await expect(page.locator('.listen-identity .track-title')).toHaveText(title);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

async function geometry(page: Page) {
  return {
    play: round(await page.locator('.now .transport .primary').boundingBox()),
    seek: round(await page.getByRole('slider', { name: 'Where in the song' }).boundingBox()),
  };
}

async function title(page: Page) {
  return page.locator('.listen-identity .track-title').evaluate((element) => {
    const css = getComputedStyle(element);
    const range = document.createRange();
    const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
    range.selectNodeContents(text);
    const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 1).map((rect) => Math.round(rect.top + rect.height / 2))).size;
    return { size: Number.parseFloat(css.fontSize), lines, height: element.getBoundingClientRect().height, text: element.textContent };
  });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useNames(page);
});

test('GP-0248-01 track, artist, mix and Stage titles are distinct type roles', async ({ page, request }) => {
  await resetMix(request, [3, 4, 5]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await listen(page, MEDIUM);
  const roles = await page.evaluate(() => Object.fromEntries(Object.entries({
    track: '.listen-identity .track-title', artist: '.listen-identity .artist', mix: '.listen-identity .eyebrow',
  }).map(([role, selector]) => {
    const css = getComputedStyle(document.querySelector(selector)!);
    return [role, { size: Number.parseFloat(css.fontSize), weight: Number(css.fontWeight), family: css.fontFamily.split(',')[0], transform: css.textTransform }];
  })));
  expect(roles.track.size).toBeGreaterThan(roles.artist.size * 1.5);
  expect(roles.artist.size).toBeGreaterThan(roles.mix.size);
  expect(new Set(Object.values(roles).map((role) => `${role.size}/${role.weight}/${role.family}/${role.transform}`)).size).toBe(3);
  const listenSize = (await title(page)).size;
  await page.keyboard.press('f');
  await expect(page.locator('.now.stage')).toBeVisible();
  await page.waitForTimeout(150);
  const stage = await page.locator('.stage .listen-identity .track-title').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(stage, 'Stage has its own title role').not.toBe(listenSize);
  expect(stage).toBeGreaterThanOrEqual(24);
  await page.keyboard.press('f');
});

for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024]] as const) {
  test(`GP-0248-02/03/05 at ${width}x${height} titles fit their slot and Play/Pause and seek stay still`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    const seen: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
    const fitted: Record<string, Awaited<ReturnType<typeof title>>> = {};
    for (const [id, name] of [[1, SHORT], [2, LONG], [3, MEDIUM]] as const) {
      await resetMix(request, [id, 4, 5]);
      await listen(page, name);
      seen[name] = await geometry(page);
      fitted[name] = await title(page);
    }
    const where = `at ${width}px`;
    // GP-0248-05: the transport and the seek bar do not move or resize as the song changes
    expect(seen[LONG], `${where} long title`).toEqual(seen[SHORT]);
    expect(seen[MEDIUM], `${where} medium title`).toEqual(seen[SHORT]);
    // GP-0248-02/03: a short title is set large; a long one wraps to at most three lines, smaller,
    // and is never shrunk below the readable floor or cut
    expect(fitted[SHORT].size).toBeGreaterThan(fitted[LONG].size);
    expect(fitted[LONG].lines, `${where}: ${JSON.stringify(fitted[LONG])}`).toBeLessThanOrEqual(3);
    expect(fitted[LONG].size).toBeGreaterThanOrEqual(24);
    expect(fitted[LONG].text).toBe(LONG);
    expect(fitted[LONG].height, `${where}: the title takes no more than a fifth of the screen`).toBeLessThanOrEqual(height * 0.2);
    expect(seen[SHORT].play!.y + seen[SHORT].play!.height).toBeLessThanOrEqual(height);
  });
}

test('GP-0248-05 Play, Loading and Pause keep one button size', async ({ page, request }) => {
  await resetMix(request, [3, 4, 5]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await listen(page, MEDIUM);
  const play = page.locator('.now .transport .primary');
  const before = round(await play.boundingBox());
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  expect(round(await play.boundingBox())).toEqual(before);
  await play.click();
  await expect(play).toHaveText('Resume');
  expect(round(await play.boundingBox())).toEqual(before);
});

test('GP-0249-02/03 the transport stays fixed while display panels open, close and change', async ({ page, request }) => {
  await resetMix(request, [3, 4, 5]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await listen(page, MEDIUM);
  const start = await geometry(page);
  await page.locator('details.dj-controls > summary').click();
  expect((await geometry(page)).play).toEqual(start.play);
  const panels = page.getByRole('group', { name: 'Visible listening panels' });
  for (const name of ['Spectrum', 'Beat countdown', 'Lyrics focus']) {
    await panels.getByRole('button', { name }).click();
    expect((await geometry(page)).play, `after ${name}`).toEqual(start.play);
    await panels.getByRole('button', { name }).click();
    expect((await geometry(page)).play, `after ${name} again`).toEqual(start.play);
  }
  // fifteen visualizer styles behind one ordinary-height control, not a tall selector
  const style = page.getByRole('combobox', { name: 'Audio visualizer style' });
  expect(await style.locator('option').count()).toBe(15);
  expect((await style.boundingBox())!.height).toBeLessThanOrEqual(48);
  await style.selectOption({ index: 7 });
  expect((await geometry(page)).play).toEqual(start.play);
  await page.locator('details.dj-controls > summary').click();
  expect((await geometry(page)).play).toEqual(start.play);
});

// GP-0248-06: song 5 is Hebrew, 6 Arabic and 7 Japanese in the made-up library; 9 and 10 are renamed above
for (const [id, script] of [[5, 'rtl'], [6, 'rtl'], [7, 'ltr'], [9, 'ltr'], [10, 'ltr']] as const) {
  test(`GP-0248-06 song ${id} keeps its whole title, its direction and its slot`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await resetMix(request, [id, 4, 3]);
    await page.goto('/listen');
    const heading = page.locator('.listen-identity .track-title');
    await expect(heading).not.toBeEmpty();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const shown = await heading.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const frame = element.closest('.listen-identity')!.getBoundingClientRect();
      const css = getComputedStyle(element);
      return {
        text: element.textContent ?? '', rtl: element.matches(':dir(rtl)'), size: Number.parseFloat(css.fontSize),
        inside: box.left >= frame.left - 1 && box.right <= frame.right + 1, clipped: element.scrollWidth > element.clientWidth + 1,
        ellipsis: css.textOverflow === 'ellipsis' || css.webkitLineClamp !== 'none',
      };
    });
    if (NAMES[id]) expect(shown.text).toBe(NAMES[id].title);
    expect(shown.rtl, 'the title takes its direction from its own words').toBe(script === 'rtl');
    expect(shown.inside, JSON.stringify(shown)).toBe(true);
    expect(shown.clipped).toBe(false);
    expect(shown.ellipsis).toBe(false);
    expect(shown.size).toBeGreaterThanOrEqual(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

// GP-0248-04/07: 320px wide (the width 400% zoom gives a 1280px window), and short landscape screens
for (const [width, height] of [[320, 640], [320, 256], [1024, 480], [640, 360]] as const) {
  test(`GP-0248-04/07 at ${width}x${height} the whole title and artist stay readable and the transport reachable`, async ({ page, request }) => {
    await page.setViewportSize({ width, height });
    await resetMix(request, [2, 4, 5]);
    await listen(page, LONG);
    const identity = await page.locator('.listen-identity').evaluate((element) => {
      const parts = ['.track-title', '.artist'].map((selector) => {
        const node = element.querySelector(selector) as HTMLElement;
        const css = getComputedStyle(node);
        return { text: node.textContent ?? '', clipped: node.scrollWidth > node.clientWidth + 1, hidden: css.visibility === 'hidden' || css.display === 'none', ellipsis: css.textOverflow === 'ellipsis' || css.webkitLineClamp !== 'none' };
      });
      return { parts, name: element.querySelector('.track-title')!.textContent };
    });
    expect(identity.parts[0].text).toBe(LONG);
    expect(identity.parts[1].text).toContain('An Ensemble With A Long Name');
    for (const part of identity.parts) {
      expect(part.clipped, JSON.stringify(part)).toBe(false);
      expect(part.hidden).toBe(false);
      expect(part.ellipsis).toBe(false);
    }
    // the screen reader reads the same complete title as its heading
    await expect(page.getByRole('heading', { level: 1, name: LONG })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling').toBe(true);
    const play = page.locator('.now .transport .primary');
    await play.scrollIntoViewIfNeeded();
    await expect(play).toBeInViewport();
    await expect(page.getByRole('slider', { name: 'Where in the song' })).toBeAttached();
  });
}
