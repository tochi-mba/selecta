import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, Page, test } from '@playwright/test';
import { allRendered, audioClock, PAGES, resetMix, soundsStarted, spyOnAudio, stickingOut } from './helpers';

/** The awkward sequences from the Selecta 3.1 verification matrix, in a real browser against a real
 * server. Each name says what has to stay true. None of this says how anything sounds or whether
 * someone can use it unaided: that takes a person. */

test.beforeEach(async ({ request }) => resetMix(request));

const playButton = (page: Page) => page.locator('.now .transport .primary');
const playButtonIn = (page: Page) => page.locator('.mini button.round');

async function startPlaying(page: Page) {
  await page.goto('/listen');
  await expect(page.locator('.lyrics')).toBeVisible();
  await playButton(page).click();
  await expect(playButton(page)).toHaveText('Pause', { timeout: 30_000 });
}

/** The first run, with the rest of the server left real, so the folder check itself is the real one. */
async function asIfNothingAdded(page: Page) {
  await page.route('**/api/status', async (route) => {
    const answer = await route.fetch();
    const status = await answer.json();
    await route.fulfill({ response: answer, json: { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 } } });
  });
}

test('a folder that can’t be used says why and what to try, nothing is read, and another can be tried straight away', async ({ page }) => {
  await asIfNothingAdded(page);
  const scans: string[] = [];
  page.on('request', (sent) => { if (sent.url().includes('/api/scan') && sent.method() === 'POST') scans.push(sent.url()); });
  const empty = mkdtempSync(join(tmpdir(), 'selecta-empty-'));
  const file = join(empty, 'a-file.txt');
  writeFileSync(file, 'not music');
  try {
    await page.goto('/');
    const box = page.getByRole('textbox', { name: 'Music folder' });
    const start = page.getByRole('button', { name: 'Start' });
    // nothing has started by itself, and focus hasn't been moved for someone reading the page
    await expect(box).not.toBeFocused();
    await expect(start).toBeDisabled();
    for (const [folder, advice] of [
      [join(empty, 'not-there'), /external drive, plug that in/],
      [file, /address of the folder it’s in/],
      [empty, /no audio files, including in subfolders/],
    ] as const) {
      await box.fill(folder);
      await start.click();
      await expect(page.getByText(advice)).toBeVisible();
      await expect(box).toBeEnabled();
      await expect(page.getByRole('heading', { name: 'Where’s your music?' })).toBeVisible();
    }
    expect(scans).toEqual([]);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('a first run says what leaves this PC before anything is sent', async ({ page }) => {
  await asIfNothingAdded(page);
  const away: string[] = [];
  page.on('request', (sent) => { if (!sent.url().startsWith('http://127.0.0.1')) away.push(sent.url()); });
  await page.goto('/');
  await expect(page.getByText(/artist, title, album and duration are sent to LRCLIB/)).toBeVisible();
  await expect(page.getByText(/original files are never moved or changed/)).toBeVisible();
  expect(away).toEqual([]);
});

test('two quick seam changes on a slow server: the last one wins, and Undo shows what’s really there', async ({ page, request }) => {
  await page.goto('/mix/current/edit');
  let release: () => void = () => {};
  const held = new Promise<void>((done) => { release = done; });
  let sent = 0;
  await page.route('**/api/mix/1/seam*', async (route) => {
    sent += 1;
    if (sent === 1) await held;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  const blend = page.getByRole('button', { name: 'Blend', exact: true });
  const cut = page.getByRole('button', { name: 'Cut', exact: true });
  await blend.click();
  await expect(blend).toHaveAttribute('aria-pressed', 'true');
  await cut.click();
  // shows what was last chosen, not what the server has so far
  await expect(cut).toHaveAttribute('aria-pressed', 'true');
  await expect(blend).toHaveAttribute('aria-pressed', 'false');
  release();
  const move = async () => ((await (await request.get('/api/mix')).json()).mix[1].seam.settings.move as string);
  await expect.poll(move, { timeout: 30_000 }).toBe('cut_on_one');
  await expect(cut).toHaveAttribute('aria-pressed', 'true');
  // and it goes on following the server after that
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect.poll(move).toBe('bass_swap_blend');
  await expect(blend).toHaveAttribute('aria-pressed', 'true');
  await expect(cut).toHaveAttribute('aria-pressed', 'false');
});

test('a slow search can’t replace a newer one, and typing keeps its place', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('button', { name: /^Details for Paper Moon/ })).toBeVisible();
  await page.route(/\/api\/library\?.*q=Neon/, async (route) => {
    await new Promise((done) => setTimeout(done, 1800));
    await route.continue();
  });
  const box = page.getByRole('searchbox', { name: 'Search your library' });
  await box.fill('Neon');
  await page.waitForTimeout(450);
  await box.fill('Paper');
  await expect(page.getByRole('button', { name: /^Details for Paper Moon/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Details for Neon Rain/ })).toHaveCount(0);
  await page.waitForTimeout(2200);
  await expect(page.getByRole('button', { name: /^Details for Neon Rain/ })).toHaveCount(0);
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('Paper');
  await expect(page).toHaveURL(/q=Paper/);
});

test('changing the theme while playing starts nothing again, and the title bar follows', async ({ page }) => {
  await spyOnAudio(page);
  await startPlaying(page);
  const before = await soundsStarted(page);
  const clockBefore = (await audioClock(page))[0];
  for (const theme of ['Dark', 'Light', 'Match this computer']) {
    await page.locator('.theme-menu > button').click();
    await page.getByRole('menuitemradio', { name: theme }).click();
    await expect(playButton(page)).toHaveText('Pause');
    const shown = await page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
    expect(shown).toBe(theme === 'Match this computer' ? 'system' : theme.toLowerCase());
    if (theme === 'Dark') {
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((bar) => bar.content))).toEqual(['#100f0c', '#100f0c']);
    }
  }
  expect(await soundsStarted(page)).toBe(before);
  await expect.poll(async () => (await audioClock(page))[0]).toBeGreaterThan(clockBefore);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});

test('a chosen theme is there from the first paint, before any of the app has run', async ({ page }) => {
  await page.goto('/mixes');
  await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: 'dark' })));
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.unroute('**/assets/*.js');
  await page.evaluate(() => localStorage.removeItem('selecta.prefs'));
});

test('fullscreen refused: the lyrics still fill the page, Escape gets out, focus comes back, and the music never stops', async ({ page }) => {
  await spyOnAudio(page);
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Permissions check failed'));
  });
  await startPlaying(page);
  await page.locator('details.view-options summary').click();
  const started = await soundsStarted(page);
  const open = page.getByRole('button', { name: 'Fullscreen lyrics' });
  await open.focus();
  await open.press('Enter');
  await expect(page.locator('.now.stage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.now.stage')).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(playButton(page)).toHaveText('Pause');
  expect(await soundsStarted(page)).toBe(started);
});

for (const [width, height] of [[1280, 860], [375, 812]]) {
  test(`Tab reaches everything on every page at ${width}px, with focus showing and never covered`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const found: string[] = [];
    for (const address of PAGES) {
      await page.goto(address);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.waitForTimeout(250);
      let same = 0;
      for (let press = 0; press < 45; press += 1) {
        await page.keyboard.press('Tab');
        const state = await page.evaluate(() => {
          const here = document.activeElement as HTMLElement | null;
          if (!here || here === document.body) return null;
          const box = here.getBoundingClientRect();
          const style = getComputedStyle(here);
          const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
          const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
          const top = document.elementFromPoint(x, y);
          const label = `${here.tagName.toLowerCase()} "${(here.getAttribute('aria-label') ?? here.textContent ?? '').trim().slice(0, 40)}"`;
          const holder = window as unknown as { lastFocused?: Element };
          const again = holder.lastFocused === here;
          holder.lastFocused = here;
          return {
            label,
            again,
            on: !!top && (top === here || here.contains(top) || top.contains(here)),
            inView: box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth,
            ring: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none',
          };
        });
        if (!state) break;
        const name = `${address} at ${width}: ${state.label}`;
        same = state.again ? same + 1 : 0;
        if (same > 3) found.push(`${name}: focus is stuck`);
        if (!state.inView) found.push(`${name}: off screen`);
        else if (!state.on) found.push(`${name}: covered`);
        if (!state.ring) found.push(`${name}: no visible focus`);
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });
}

test('pages hold their shape while they load, even when every answer is slow', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { shifted: number }).shifted = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) (window as unknown as { shifted: number }).shifted += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const found: Record<string, number> = {};
  await page.route('**/api/**', async (route) => {
    await new Promise((done) => setTimeout(done, 350));
    await route.continue();
  });
  for (const address of PAGES) {
    await page.goto(address);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    found[address] = Math.round(await page.evaluate(() => (window as unknown as { shifted: number }).shifted) * 1000) / 1000;
  }
  console.log(`layout shift while loading slowly: ${JSON.stringify(found)}`);
  const bad = Object.entries(found).filter(([, shift]) => shift > 0.25);
  expect(bad).toEqual([]);
});

test('the first run says which stage it’s at, from what the server says, and each can go wrong on its own', async ({ page, request }) => {
  const status = await (await request.get('/api/status')).json();
  const withCounts = (more: Record<string, unknown>) => ({ ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 }, ...more });
  let answer = withCounts({ scan: { status: 'running', folder: 'D:\\Music' } });
  await page.route('**/api/status', (route) => route.fulfill({ json: answer }));
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Finding music in your folder' })).toContainText('D:\\Music');
  await expect(page.getByRole('button', { name: 'Stop reading this folder' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reading…' })).toBeDisabled();
  answer = withCounts({ scan: { status: 'cancelled' } });
  await expect(page.getByText(/Stopped reading that folder. Nothing was moved or changed/)).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText(/Stopped reading that folder/)).toBeVisible();
  answer = withCounts({ scan: { status: 'failed', error: 'That drive went away part way through.' } });
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'That drive went away part way through.' })).toBeVisible();
  // and it can always be tried again, without starting anything over
  await expect(page.getByRole('textbox', { name: 'Music folder' })).toBeEnabled();
  answer = withCounts({ scan: { status: 'done', music: 0 } });
  await page.reload();
  await expect(page.getByText(/No new music was found in that folder/)).toBeVisible();
  // some songs found, not enough ready: the second step, and the rest of the app is open
  answer = { ...status, counts: { ...status.counts, total: 40, music: 40, analysed: 3, ready: 2 }, scan: { status: 'idle' } };
  await page.goto('/mixes');
  await expect(page.locator('.setup-steps li[aria-current="step"]')).toContainText('Prepare library');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library' })).toBeVisible();
});

test('with an on-screen keyboard up, what’s being typed gets the room', async ({ page }) => {
  await startPlaying(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(page.locator('.mini')).toBeVisible();
  const box = page.getByRole('searchbox', { name: 'Search your library' });
  await box.focus();
  // a real phone sets this from how much of the window its keyboard covers, which a desktop browser can't do
  await page.evaluate(() => { document.documentElement.dataset.keyboard = 'open'; });
  await expect(page.locator('.mini')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(box).toBeFocused();
  await expect(box).toBeInViewport();
  await page.evaluate(() => { delete document.documentElement.dataset.keyboard; });
  await expect(page.locator('.mini')).toBeVisible();
  await expect(playButtonIn(page)).toBeVisible();
});

test('the full Studio grid works at the smallest size: it scrolls by itself, and the keyboard can reach all of it', async ({ page, request }) => {
  const cells = 8;
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const shape = { a: { vocals: row, drums: row, bass: row, other: row }, b: { vocals: row, drums: row, bass: row, other: row } };
  const stem = await (await request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => route.fulfill({ json: { status: 'ready', key: 'smallest', cells, seconds: 8, bars: 16, start_shape: shape, shape } }));
  await page.route('**/api/mix/1/options*', async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), studio: { available: true } } });
  });
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  const squares = page.locator('.studio-cell');
  await expect(squares.first()).toBeVisible({ timeout: 60_000 });
  expect(await squares.count()).toBe(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const first = squares.first();
  await first.focus();
  for (let move = 0; move < 7; move += 1) await page.keyboard.press('ArrowRight');
  const last = page.getByRole('button', { name: 'Morning Light voice, square 8' });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  // the part's own name stays in sight while the squares scroll past it
  await expect(page.getByRole('button', { name: 'Hear only Morning Light voice' })).toBeInViewport();
  const was = await last.getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  await expect(last).not.toHaveAttribute('aria-pressed', was ?? '');
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio')).toHaveCount(0);
});

test('the keyboard alone can request a song, cancel it, and get back to where it was', async ({ page, request }) => {
  await page.goto('/listen');
  await expect(page.locator('.lyrics')).toBeVisible();
  await page.keyboard.press('r');
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await expect(drawer).toBeVisible();
  const box = drawer.getByRole('textbox', { name: 'Request a song' });
  await expect(box).toBeFocused();
  await box.fill('Déjà');
  await expect(drawer.getByRole('button', { name: /Déjà Vu/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('list', { name: 'Your requests' }).getByText('Déjà Vu')).toBeVisible();
  // the search keeps its place, so a few can be asked for in a row
  await expect(box).toBeFocused();
  const cancel = drawer.getByRole('button', { name: 'Cancel request for Déjà Vu' });
  await expect(cancel).toBeEnabled();
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('list', { name: 'Your requests' })).toHaveCount(0);
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  const { requests } = await (await request.get('/api/requests')).json();
  expect(requests).toEqual([]);
});

test('reordering with the keyboard moves the song, and focus stays on it', async ({ page, request }) => {
  await page.goto('/mix/current/edit');
  const grip = page.getByRole('button', { name: 'Reorder Morning Light' });
  await grip.focus();
  await page.keyboard.press('ArrowDown');
  const order = async () => ((await (await request.get('/api/mix')).json()).mix as { title: string }[]).map((song) => song.title);
  await expect.poll(order).toEqual(['Slow Tide', 'Morning Light', 'Paper Moon', 'Neon Rain']);
  await expect(page.getByRole('button', { name: 'Reorder Morning Light' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect.poll(order).toEqual(['Morning Light', 'Slow Tide', 'Paper Moon', 'Neon Rain']);
  await expect(page.getByRole('button', { name: 'Reorder Morning Light' })).toBeFocused();
});

test('a transition’s tabs work from the keyboard, and it stays clear which pair they’re about', async ({ page }) => {
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  const change = page.getByRole('tab', { name: 'Change' });
  await expect(change).toHaveAttribute('aria-selected', 'true');
  await change.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Studio' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Studio' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Listen' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.inspector-pair')).toContainText('Morning Light');
  await expect(page.locator('.inspector-pair')).toContainText('Slow Tide');
});

test('the command palette says why a command can’t run, and works from the keyboard alone', async ({ page, request }) => {
  await request.post('/api/mix/clear');
  await page.goto('/library');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Search for a page or a command' });
  await expect(box).toBeFocused();
  await box.fill('next song');
  const option = page.getByRole('option', { name: /Next song/ });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toContainText('Nothing is playing.');
  await page.keyboard.press('Enter');
  // it stays open and says so, rather than doing nothing
  await expect(box).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Nothing is playing' })).toBeVisible();
  // nothing by that name is still a way to look for it
  await box.fill('zzzzzz');
  await expect(page.getByRole('option', { name: /Search your library for “zzzzzz”/ })).toBeVisible();
  await box.fill('har');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/discover\/harmonic$/);
  await resetMix(request);
});

test('playing doesn’t flood a screen reader: the song is said once, and the clock never is', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { spoken: string[] }).spoken = [];
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((changes) => {
        for (const change of changes) {
          const region = (change.target as Element).parentElement ?? (change.target as Element);
          const live = region.closest?.('[aria-live]:not([aria-live="off"]),[role="status"],[role="alert"]');
          if (live) (window as unknown as { spoken: string[] }).spoken.push((live.textContent ?? '').trim().slice(0, 60));
        }
      }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    });
  });
  await startPlaying(page);
  await page.evaluate(() => { (window as unknown as { spoken: string[] }).spoken.length = 0; });
  await page.waitForTimeout(6000);
  const spoken = await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken);
  // nothing with a clock in it, and no more than a few real changes while nothing else has happened
  expect(spoken.filter((words) => /\d:\d\d/.test(words))).toEqual([]);
  expect(spoken.length).toBeLessThan(6);
});

test('with reduced motion nothing keeps moving by itself, on any page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const found: string[] = [];
  for (const address of PAGES) {
    await page.goto(address);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.waitForTimeout(300);
    const moving = await page.evaluate(() => document.getAnimations()
      .filter((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity)
      .map((animation) => (animation.effect as KeyframeEffect).target?.className ?? 'something'));
    found.push(...moving.map((name) => `${address}: ${name}`));
  }
  expect(found).toEqual([]);
});

test('the mini-player and bottom bar never overlap, and the last row can always be reached', async ({ page }) => {
  await startPlaying(page);
  const found: string[] = [];
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [568, 320], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('link', { name: 'Library' }).first().click();
    await expect(page.locator('.mini')).toBeVisible();
    await page.waitForTimeout(150);
    // rows off screen only have an estimated height, so the bottom moves as they're reached
    for (let again = 0; again < 4; again += 1) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(120);
    }
    const geometry = await page.evaluate(() => {
      const mini = document.querySelector('.mini')!.getBoundingClientRect();
      const nav = document.querySelector('.nav')!.getBoundingClientRect();
      const rows = document.querySelectorAll('.library-rows .song-row');
      const last = rows[rows.length - 1].getBoundingClientRect();
      return { mini: [mini.top, mini.bottom], nav: [nav.top, nav.bottom, nav.left, nav.right], last: last.bottom, height: window.innerHeight, navAtBottom: nav.width > window.innerWidth / 2 };
    });
    const place = `${width}x${height}`;
    if (geometry.navAtBottom && geometry.mini[1] > geometry.nav[0] + 1) found.push(`${place}: the player runs into the bottom bar`);
    if (geometry.last > geometry.mini[0] + 1) found.push(`${place}: the last row stays behind the player`);
    if (geometry.mini[1] > geometry.height + 1) found.push(`${place}: the player runs off the screen`);
    found.push(...await stickingOut(page, place));
    await page.getByRole('link', { name: 'Listen' }).first().click();
    await expect(playButton(page)).toBeVisible();
  }
  expect(found).toEqual([]);
});

test('long, right-to-left and duplicate names stay readable and whole at the smallest size', async ({ page, request }) => {
  await resetMix(request, [8, 5, 6, 10, 11]);
  await page.setViewportSize({ width: 320, height: 568 });
  const found: string[] = [];
  for (const address of ['/listen', '/mixes/mine', '/mix/current/edit', '/library', '/mixes']) {
    await page.goto(address);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.waitForTimeout(250);
    found.push(...await stickingOut(page, address));
    const cut = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('h1, h2, .song-name b, .next-song b, .draft-name b')]
      .filter((element) => getComputedStyle(element).textOverflow !== 'ellipsis' && element.scrollWidth > element.clientWidth + 1)
      .map((element) => (element.textContent ?? '').slice(0, 40)));
    found.push(...cut.map((name) => `${address}: "${name}" is cut off`));
  }
  expect(found).toEqual([]);
  // two songs with the same name are still told apart
  await page.goto('/mix/current/edit');
  await expect(page.getByText('Hal Greene')).toBeVisible();
  await expect(page.getByText('Iris Vale')).toBeVisible();
});

test('a saved file has the songs of the mix at the moment it was saved, in that order, whatever happens next', async ({ page, request }) => {
  test.setTimeout(420_000);
  await allRendered(request);
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Download audio' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  const save = dialog.getByRole('button', { name: 'Save it', exact: true });
  if (await save.count()) await save.click();
  // closing the panel, changing the mix and reloading the page all lose nothing
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const { mix } = await (await request.get('/api/mix')).json();
  const songs = (mix as { song_id: number; title: string }[]).map((song) => song.song_id);
  await request.delete('/api/mix/songs/3', { headers: { 'x-mix-order': songs.join(',') } }).catch(() => {});
  await request.post('/api/mix/move', { data: { from: 0, to: 1 } }).catch(() => {});
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  let job: { name: string; state: string; seconds: number; songs: { song_id: number }[] } | undefined;
  await expect.poll(async () => {
    const { jobs } = await (await request.get('/api/exports/jobs')).json();
    job = (jobs as NonNullable<typeof job>[]).find((item) => item.songs.map((song) => song.song_id).join() === songs.join() && item.state === 'ready');
    return job?.state;
  }, { timeout: 240_000, intervals: [2000] }).toBe('ready');
  await page.getByRole('button', { name: /^Activity/ }).click();
  await expect(page.getByRole('dialog', { name: 'Activity' }).getByRole('link', { name: new RegExp(job!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()).toBeVisible();

  const folder = mkdtempSync(join(tmpdir(), 'selecta-export-'));
  try {
    const save_ = async (name: string, address: string) => {
      const path = join(folder, name);
      writeFileSync(path, await (await request.get(address)).body());
      return path;
    };
    const exported = await save_('export.flac', `/api/exports/${encodeURIComponent(job!.name)}`);
    const parts = [];
    for (const id of songs) parts.push(await save_(`song-${id}.flac`, `/api/songs/${id}/audio`));
    const other = await save_('other.flac', '/api/songs/9/audio');
    const report = join(folder, 'report.json');
    const python = process.env.SELECTA_PYTHON ?? 'uv run python';
    execSync(`${python} ../tests/check_export_audio.py "${report}" "${exported}" ${parts.map((part) => `"${part}"`).join(' ')} --not "${other}"`, { stdio: 'inherit' });
    const measured = JSON.parse(readFileSync(report, 'utf-8'));
    console.log(JSON.stringify(measured));
    expect(measured.format).toBe('FLAC');
    expect(measured.channels).toBe(2);
    expect(measured.seconds).toBeCloseTo(job!.seconds, 1);
    // every song in the mix is really in there, and shorter than the songs put end to end
    for (const song of measured.songs) expect(song.score).toBeGreaterThan(0.9);
    const places = measured.songs.map((song: { seconds_into_export: number }) => song.seconds_into_export);
    expect(places).toEqual([...places].sort((one, other_) => one - other_));
    expect(new Set(places).size).toBe(places.length);
    // and a song that isn't in the mix isn't, which shows the check can tell them apart
    for (const song of measured.absent) expect(song.score).toBeLessThan(0.6);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
