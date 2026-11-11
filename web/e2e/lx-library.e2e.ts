/* LX-0340 to LX-0352: the Library experience in a real browser against the made-up library from
 * tests/e2e_server.py (twelve ready songs, two titled "Same Name" as recordings 10 and 11, a long
 * title, right-to-left and CJK names, a set-aside talk as 13 and a broken file as 14). Each test
 * names the checklist items it proves. The unit-level twins are in src/views/LibraryLx.test.tsx. */
import { expect, Locator, Page, test } from '@playwright/test';
import { resetMix } from './helpers';

test.beforeEach(async ({ request }) => resetMix(request));

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search your library' });
const rows = (page: Page) => page.locator('ul.library-rows > li');

async function openLibrary(page: Page, address = '/library') {
  await page.goto(address);
  await expect(page.locator('.library-count')).toBeVisible();
}

async function useLayout(page: Page, layout: 'List view' | 'Card view') {
  await page.getByRole('button', { name: layout }).click();
  await expect(page.getByRole('button', { name: layout })).toHaveAttribute('aria-pressed', 'true');
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** The control really receives a press at its centre: nothing (player, nav, sheet) lies on top. */
async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  return control.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!hit && (hit === node || node.contains(hit));
  });
}

const noSideScroll = (page: Page) => page.evaluate(() => {
  const root = document.scrollingElement!;
  return root.scrollWidth <= root.clientWidth + 1;
});

test('LX-0340-03 one reading order: heading, search, filters, count, results, in DOM, Tab and the accessibility outline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  const order = await page.evaluate(() => {
    const at = (selector: string) => document.querySelector(selector)!;
    const parts = [at('main h1'), at('main input[type=search]'), at('.library-filters'), at('.library-count'), at('ul.library-rows')];
    return parts.every((node, index) => index === 0 || (parts[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBe(true);
  // Tab from the search box walks the regions forwards, never jumping back to an earlier one
  await search(page).focus();
  const regions: number[] = [];
  for (let step = 0; step < 24; step += 1) {
    await page.keyboard.press('Tab');
    regions.push(await page.evaluate(() => {
      const active = document.activeElement!;
      const names = ['.library-find', '.library-filters', '.library-batch', 'ul.library-rows'];
      return names.findIndex((selector) => document.querySelector(selector)?.contains(active));
    }));
  }
  const seen = regions.filter((region) => region >= 0);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
  expect(new Set(seen)).toEqual(new Set([0, 1, 2, 3]));
  const outline = await page.locator('main').ariaSnapshot();
  const lines = outline.split('\n');
  const places = [/- heading "Library" \[level=1\]/, /- searchbox "Search your library"/, /- group "Filter Library recordings"/, /- status:? .*songs/, /- list\b/]
    .map((pattern) => lines.findIndex((line) => pattern.test(line)));
  expect(places.every((place) => place >= 0)).toBe(true);
  expect(places).toEqual([...places].sort((a, b) => a - b));
});

test('LX-0340-05 LX-0344-01 LX-0345-03 duplicate titles stay bound to their recording ID, through reorder and in both layouts', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  for (const layout of ['List view', 'Card view'] as const) {
    await useLayout(page, layout);
    for (const [id, artist] of [[10, 'Hal Greene'], [11, 'Iris Vale']] as const) {
      // same title, different artist: every control names the artist, and the checkbox the ID
      const row = rows(page).filter({ has: page.getByRole('button', { name: `Details for Same Name by ${artist}` }) });
      await expect(row).toHaveCount(1);
      await expect(row.getByText(artist, { exact: true })).toBeVisible();
      await expect(row.getByRole('button', { name: `More actions for Same Name by ${artist}` })).toHaveCount(1);
      await expect(row.getByRole('checkbox')).toHaveAccessibleName(`Select recording Same Name by ${artist}, ID ${id}`);
      // title and artist never sit on top of each other
      const title = await box(row.locator('.song-open b'));
      const by = await box(row.getByText(artist, { exact: true }));
      expect(overlap(title, by)).toBe(0);
    }
    // reorder, then the same button still opens the same recording
    for (const sort of ['artist', 'recent', 'tempo', 'title']) {
      await page.getByRole('combobox', { name: 'Sort by' }).selectOption(sort);
      await expect(page).toHaveURL(sort === 'title' ? /\/library$/ : new RegExp(`sort=${sort}`));
      await page.getByRole('button', { name: 'Details for Same Name by Iris Vale' }).click();
      const sheet = page.getByRole('dialog', { name: 'Same Name' });
      await expect(sheet.getByText('Recording ID 11')).toBeVisible();
      await expect(sheet.getByText('Iris Vale')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }
  }
  await useLayout(page, 'List view');
});

test('LX-0340-06 LX-0343-06 LX-0345-06 list and cards share address, count, order, selection and saved choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page, '/library?sort=artist&q=a');
  const before = {
    url: page.url(),
    count: await page.locator('.library-count').textContent(),
    names: await page.locator('.song-open').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))),
  };
  expect(before.names.length).toBeGreaterThan(2);
  await rows(page).nth(1).getByRole('checkbox').check();
  await useLayout(page, 'Card view');
  await expect(page.locator('ul.library-rows')).toHaveClass(/library-cards/);
  expect(page.url()).toBe(before.url);
  await expect(page.locator('.library-count')).toHaveText(before.count!);
  expect(await page.locator('.song-open').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).toEqual(before.names);
  await expect(rows(page).nth(1).getByRole('checkbox')).toBeChecked();
  await expect(page.getByText(/^1 of \d+ loaded recordings selected/)).toBeVisible();
  // the choice is remembered, and the address alone restores the same results
  await page.reload();
  await expect(page.getByRole('button', { name: 'Card view' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.song-open').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).toEqual(before.names);
  await useLayout(page, 'List view');
});

for (const layout of ['List view', 'Card view'] as const) {
  test(`LX-0341-04 LX-0344-06 LX-0345-05 LX-0351-01 LX-0351-02 ${layout} fits 320 to 1440 and 400% zoom with identity, readiness and an action on every row`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLibrary(page);
    await useLayout(page, layout);
    // 320x180 is 1280x720 at 400% zoom
    for (const size of [[320, 568], [320, 180], [375, 667], [768, 1024], [1024, 768], [1280, 900], [1440, 900]]) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await expect.poll(() => noSideScroll(page), { message: `side scroll at ${size}` }).toBe(true);
      const counters = await page.locator('.library-summary > *').evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      }));
      expect(counters.every(Boolean)).toBe(true);
      const problems = await rows(page).evaluateAll((items) => items.flatMap((item) => {
        const part = (selector: string) => item.querySelector(selector)?.getBoundingClientRect();
        const name = part('.song-open b');
        const artist = item.querySelector('.song-name > span[dir]')?.getBoundingClientRect();
        const status = part('.song-readiness .status');
        const action = part('.song-actions button');
        const row = item.getBoundingClientRect();
        const found: string[] = [];
        for (const [label, rect] of [['title', name], ['artist', artist], ['readiness', status], ['action', action]] as const) {
          if (!rect || rect.width < 1 || rect.height < 1) found.push(`${item.textContent?.slice(0, 20)}: no ${label}`);
          else if (rect.left < row.left - 1 || rect.right > row.right + 1 || rect.right > window.innerWidth + 1) found.push(`${label} outside row`);
        }
        // the name column never runs into the facts, readiness or action columns
        const nameBox = part('.song-name')!;
        for (const other of ['.song-columns', '.song-readiness', '.song-actions']) {
          const rect = part(other)!;
          const shared = Math.max(0, Math.min(nameBox.right, rect.right) - Math.max(nameBox.left, rect.left))
            * Math.max(0, Math.min(nameBox.bottom, rect.bottom) - Math.max(nameBox.top, rect.top));
          if (shared > 1) found.push(`name overlaps ${other}`);
        }
        return found;
      }));
      expect(problems, `at ${size}`).toEqual([]);
    }
    // a long name is still whole for assistive technology
    await expect(page.getByRole('button', { name: /^Details for An Extraordinarily Long Song Title .*\(Extended Club Remix\)$/ })).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await useLayout(page, 'List view');
  });
}

test('LX-0341-05 LX-0344-07 LX-0350-04 LX-0350-05 a background change keeps numbers steady, focus on its recording and the scroll still', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openLibrary(page);
  expect(await page.locator('.library-summary b').first().evaluate((node) => getComputedStyle(node).fontVariantNumeric)).toContain('tabular-nums');
  expect(await page.locator('.song-columns span').first().evaluate((node) => getComputedStyle(node).fontVariantNumeric)).toContain('tabular-nums');
  const target = page.getByRole('button', { name: 'Details for Same Name by Iris Vale' });
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  const scrolled = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    (window as unknown as { shifts: number }).shifts = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) (window as unknown as { shifts: number }).shifts += entry.value;
      }
    }).observe({ type: 'layout-shift' });
  });
  // songs above and at the focused row change in the background, as an analysis finishing would
  await request.post('/api/songs/2/correct', { data: { bpm: 99 } });
  await request.post('/api/songs/11/correct', { data: { bpm: 131 } });
  try {
    const row = rows(page).filter({ has: target });
    await expect(row.locator('.song-columns')).toContainText('131 BPM', { timeout: 30_000 });
    await expect(target).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts)).toBeLessThan(0.01);
    expect(Math.abs(await page.evaluate(() => window.scrollY) - scrolled)).toBeLessThanOrEqual(1);
  } finally {
    await request.post('/api/songs/2/correct', { data: { clear: ['bpm'] } });
    await request.post('/api/songs/11/correct', { data: { clear: ['bpm'] } });
  }
});

test('LX-0342-02 LX-0343-03 query, filter and sort live in the address and Back/Forward shows the server\'s own order', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  const titles = () => page.locator('.song-open').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  const serverTitles = async (params: Record<string, string>) => {
    const answer = await (await request.get('/api/library', { params: { state: 'all', sort: 'title', q: '', limit: '100', ...params } })).json();
    // LX-0340-05: a title two different artists share is spoken with its artist, so each button names its own recording
    const songs = answer.songs as { title: string; artist: string }[];
    const shared = (song: { title: string; artist: string }) => songs.some((other) => other !== song && other.title === song.title && other.artist !== song.artist);
    return songs.map((song) => (shared(song) ? `${song.title} by ${song.artist}` : song.title));
  };
  const matches = async (params: Record<string, string>) => {
    const want = await serverTitles(params);
    await expect.poll(async () => (await titles()).map((label) => label!.replace(/^Details for /, '').replace(/ \(song \d+\)$/, ''))).toEqual(want);
  };
  await search(page).fill('a');
  await expect(page).toHaveURL(/\?q=a$/);
  await matches({ q: 'a' });
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(page).toHaveURL(/show=ready/);
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('artist');
  await expect(page).toHaveURL(/sort=artist/);
  await matches({ q: 'a', state: 'ready', sort: 'artist' });
  await page.goBack();
  await expect(page).not.toHaveURL(/sort=artist/);
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('title');
  await matches({ q: 'a', state: 'ready' });
  await page.goBack();
  await expect(page).not.toHaveURL(/show=ready/);
  await expect(page.getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'true');
  await matches({ q: 'a' });
  await page.goForward();
  await page.goForward();
  await expect(page).toHaveURL(/sort=artist/);
  await matches({ q: 'a', state: 'ready', sort: 'artist' });
  for (const sort of ['tempo', 'recent']) {
    await page.goto(`/library?sort=${sort}`);
    await matches({ sort });
  }
});

test('LX-0342-03 LX-0342-04 match reasons come from the server, and a number finds that exact recording', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const q of ['11', 'Paper Moon', 'Iris']) {
    await openLibrary(page, `/library?q=${encodeURIComponent(q)}`);
    const answer = await (await request.get('/api/library', { params: { q, state: 'all' } })).json();
    const first = answer.songs[0];
    expect(first.match).toBeTruthy();
    const row = rows(page).first();
    await expect(row.getByLabel(`Search match: ${first.match}`)).toHaveText(first.match);
    if (q === '11') {
      expect(first.match).toBe('Recording ID');
      await row.locator('.song-open').click();
      await expect(page.getByRole('dialog').getByText('Recording ID 11')).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
  // a link to recording 10 opens 10, never its same-titled neighbour 11
  await openLibrary(page, '/library?song=10');
  const sheet = page.getByRole('dialog', { name: 'Same Name' });
  await expect(sheet.getByText('Recording ID 10')).toBeVisible();
  await expect(sheet.getByText('Hal Greene')).toBeVisible();
});

test('LX-0343-02 LX-0351-03 filters show their state without colour, wrap at 320px and work by keyboard and touch', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await openLibrary(page);
  const filters = page.getByRole('group', { name: 'Filter Library recordings' }).getByRole('button');
  const boxes = await filters.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, text: node.textContent };
  }));
  expect(boxes.every((rect) => rect.left >= 0 && rect.right <= 320 && rect.text)).toBe(true);
  // Tab order follows the visual order: line by line, left to right
  const visual = [...boxes].sort((a, b) => (Math.abs(a.top - b.top) > 4 ? a.top - b.top : a.left - b.left)).map((rect) => rect.text);
  expect(boxes.map((rect) => rect.text)).toEqual(visual);
  await filters.first().focus();
  await page.keyboard.press('Tab');
  await expect(filters.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(filters.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Needs attention' }).tap();
  await expect(page.getByRole('button', { name: 'Needs attention' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Clear all filters' })).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const [on, off] = await Promise.all([
      page.getByRole('button', { name: 'Needs attention' }).evaluate((node) => getComputedStyle(node).boxShadow),
      page.getByRole('button', { name: 'Ready', exact: true }).evaluate((node) => getComputedStyle(node).boxShadow),
    ]);
    // a shape (an underline) marks the chosen filter, not a colour change alone
    expect(on).toContain('inset');
    expect(on).not.toBe(off);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  const [onEdge, offEdge] = await Promise.all([
    page.getByRole('button', { name: 'Needs attention' }).evaluate((node) => getComputedStyle(node).borderColor),
    page.getByRole('button', { name: 'Ready', exact: true }).evaluate((node) => getComputedStyle(node).borderColor),
  ]);
  expect(onEdge).not.toBe(offEdge);
  await context.close();
});

test('LX-0346-06 LX-0349-05 the More menu works by keyboard and touch, and Never play and set aside both undo', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openLibrary(page);
  // Last Call is not in the current mix, so Add is the first live item
  const row = rows(page).filter({ hasText: 'Last Call' });
  const more = page.getByRole('button', { name: 'More actions for Last Call' });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Add to current mix' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Prioritize' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  // touch: open, choose Never play, and the row says so
  await more.tap();
  await page.getByRole('menuitemcheckbox', { name: 'Never play' }).tap();
  await expect(row.getByText('Never plays')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Start a mix' })).toHaveCount(0);
  await more.tap();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Never: on' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemcheckbox', { name: 'Never: on' }).tap();
  await expect(row.getByText('Ready for mixes')).toBeVisible();
  // set aside is a different state with its own way back
  await page.getByRole('button', { name: 'Details for Last Call' }).click();
  await page.getByRole('button', { name: 'This isn’t music' }).click();
  await page.keyboard.press('Escape');
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Set aside', exact: true }).click();
  await page.getByRole('button', { name: 'Details for Last Call' }).click();
  await expect(page.getByRole('dialog').getByText('Set aside', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'This is music' }).click();
  await page.getByRole('button', { name: 'Let Selecta decide' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Everything' }).click();
  await expect(rows(page).filter({ hasText: 'Last Call' }).getByText('Ready for mixes')).toBeVisible();
  await context.close();
});

test('LX-0346-03 LX-0347-01 LX-0347-03 LX-0347-06 on a phone with music playing: replacement asks first, and the selection rail stays above the player', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('link', { name: 'Library' }).first().click();
  const mini = page.getByRole('complementary', { name: 'Now playing' });
  await expect(mini).toBeVisible();
  // a mix starting from a song asks before it replaces what's playing, and Keep changes nothing
  const start = rows(page).filter({ hasText: 'Paper Moon' }).getByRole('button', { name: 'Start a mix' });
  await start.click();
  const dialog = page.getByRole('dialog', { name: 'Replace your current mix?' });
  await expect(dialog).toBeVisible();
  expect(await reachable(dialog.getByRole('button', { name: 'Replace and play' }))).toBe(true);
  await dialog.getByRole('button', { name: 'Keep current mix' }).click();
  await expect(dialog).toBeHidden();
  await expect(start).toBeFocused();
  await expect(mini).toBeVisible();
  expect((await (await page.request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id)).toEqual([1, 2, 3, 4]);
  // nothing selected: one compact entry, no action forest
  await expect(page.getByRole('button', { name: 'Select up to 200 loaded songs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prioritize selected' })).toHaveCount(0);
  await rows(page).nth(0).getByRole('checkbox').check();
  await rows(page).nth(1).getByRole('checkbox').check();
  await expect(page.getByText(/^2 of 13 loaded recordings selected \(limit 200\)/)).toBeVisible();
  for (const name of ['Clear selection', 'Prioritize selected', 'Never play selected']) {
    expect(await reachable(page.getByRole('button', { name })), `${name} under the player or nav`).toBe(true);
  }
  // with the on-screen keyboard open the rail is still reachable
  await page.evaluate(() => { document.documentElement.dataset.keyboard = 'open'; });
  expect(await reachable(page.getByRole('button', { name: 'Clear selection' }))).toBe(true);
  await page.evaluate(() => { delete document.documentElement.dataset.keyboard; });
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByRole('button', { name: 'Select up to 200 loaded songs' })).toBeFocused();
});

test('LX-0348-05 LX-0348-07 the song sheet corrects with focus on errors, and closing returns to the exact row, scroll and address', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openLibrary(page);
  const opener = page.getByRole('button', { name: 'Details for Last Call' });
  await opener.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  await opener.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Last Call' });
  await expect(sheet).toBeVisible();
  // identity, then the facts, then the controls
  const order = await sheet.evaluate((node) => {
    const at = (selector: string) => node.querySelector(selector)!;
    const parts = [at('.song-details-identity'), at('.song-facts'), at('input')];
    return parts.every((part, index) => index === 0 || (parts[index - 1].compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBe(true);
  const tempo = sheet.getByRole('spinbutton', { name: /Tempo/ });
  await tempo.fill('999');
  await sheet.getByRole('button', { name: 'Save correction' }).click();
  await expect(sheet.getByText('Tempo has to be between 40 and 240.')).toBeVisible();
  await expect(tempo).toBeFocused();
  await expect(tempo).toHaveValue('999');
  await tempo.fill('124');
  await sheet.getByRole('button', { name: 'Save correction' }).click();
  await expect(sheet.getByText('124 BPM (your correction)')).toBeVisible();
  await expect(sheet.getByText('Tempo measured').locator('xpath=following-sibling::dd')).toHaveText('120 BPM');
  await sheet.getByRole('button', { name: 'Use what was measured' }).click();
  await expect(sheet.getByText('(your correction)')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scrolled)).toBeLessThanOrEqual(1);
  // a link to a song is a history entry: Back closes it, Forward brings the same one back
  await page.goto('/library?song=11');
  await expect(page.getByRole('dialog', { name: 'Same Name' }).getByText('Recording ID 11')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('dialog', { name: 'Same Name' }).getByText('Recording ID 11')).toBeVisible();
});

test('LX-0352-04 LX-0352-05 a failed refresh keeps rows labelled stale with writes held, and Retry keeps query, sort and scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openLibrary(page, '/library?sort=artist');
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const scrolled = await page.evaluate(() => window.scrollY);
  // the first row in view, and where it sits on screen: a stale notice added above may scroll-anchor the page, never move the rows
  const inView = await rows(page).evaluateAll((items) => items.findIndex((item) => item.getBoundingClientRect().top >= 0));
  const rowTop = async () => (await box(rows(page).nth(inView))).y;
  const shownAt = await rowTop();
  const address = page.url();
  await page.route('**/api/library?**', (route) => route.abort());
  await expect(page.getByText('Can’t check on your library right now, so what’s shown may be out of date.')).toBeVisible({ timeout: 30_000 });
  await expect(rows(page)).toHaveCount(13);
  await expect(page.getByRole('button', { name: 'Select up to 200 loaded songs' })).toBeDisabled();
  await expect(rows(page).first().getByRole('checkbox')).toBeDisabled();
  await page.unroute('**/api/library?**');
  // pressed in place, so the test itself doesn't scroll the page to the button
  expect(Math.abs(await rowTop() - shownAt), 'the rows moved when the refresh failed').toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Retry loading' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText(/may be out of date/)).toHaveCount(0);
  expect(page.url()).toBe(address);
  await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('artist');
  await expect(rows(page)).toHaveCount(13);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - scrolled)).toBeLessThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Select up to 200 loaded songs' })).toBeEnabled();
});

test('LX-0352-02 LX-0352-06 the placeholder matches the layout, never pulses under reduced motion or Still, and says it is loading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const layout of ['List view', 'Card view'] as const) {
    await openLibrary(page);
    await useLayout(page, layout);
    // the typical row, not the one long title
    const heights = (await rows(page).evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height))).sort((a, b) => a - b);
    const real = { height: heights[Math.floor(heights.length / 2)] };
    let release: () => void = () => {};
    const held = new Promise<void>((done) => { release = done; });
    await page.route('**/api/library?**', async (route) => { await held; await route.continue(); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const skeleton = page.getByRole('status', { name: 'Loading your songs' });
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toContainText('Loading your songs');
    await expect(skeleton).toHaveClass(layout === 'Card view' ? /skeleton-cards/ : /skeleton-library/);
    const unit = await box(skeleton.locator('.skeleton-unit').first());
    // same footprint as the row it stands in for, so nothing jumps when songs arrive
    expect(Math.abs(unit.height - real.height)).toBeLessThanOrEqual(real.height * 0.35);
    expect(await skeleton.locator('i').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { document.documentElement.dataset.motion = 'still'; });
    expect(await skeleton.locator('i').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    release();
    await page.unroute('**/api/library?**');
    await expect(rows(page).first()).toBeVisible();
  }
  await useLayout(page, 'List view');
});

test('LX-0352-07 nothing is re-announced while the library refreshes with no change', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  await page.evaluate(() => {
    const changes: string[] = [];
    (window as unknown as { liveChanges: string[] }).liveChanges = changes;
    const watcher = new MutationObserver((records) => {
      for (const record of records) {
        const region = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[role=status], [role=alert], [aria-live]');
        if (region && region.closest('main')) changes.push(region.textContent ?? '');
      }
    });
    watcher.observe(document.querySelector('main')!, { subtree: true, childList: true, characterData: true });
  });
  const refreshed = page.waitForResponse((response) => response.url().includes('/api/library?'), { timeout: 30_000 });
  await refreshed;
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { liveChanges: string[] }).liveChanges)).toEqual([]);
});

test('LX-0341-07 the set-aside count opens exactly those songs and Back returns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  await page.getByRole('button', { name: '1 set aside' }).click();
  await expect(page).toHaveURL(/\?show=set_aside$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Episode 12');
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expect(rows(page)).toHaveCount(13);
});

test('LX-0341-06 LX-0345-02 LX-0345-04 no invented metrics or artwork, motifs only, and cards never call a broken song ready', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  for (const layout of ['List view', 'Card view'] as const) {
    await useLayout(page, layout);
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/hours? listened|plays?\b.*\d|rating|score|% (complete|done)|quality/i);
    await expect(page.locator('main img')).toHaveCount(0);
    expect(await rows(page).locator('.song-motif').count()).toBe(13);
    const broken = rows(page).filter({ hasText: 'Broken File' });
    await expect(broken.getByText('Couldn’t be analysed')).toBeVisible();
    await expect(broken.getByRole('button', { name: 'Start a mix' })).toHaveCount(0);
    await expect(rows(page).filter({ hasText: 'Paper Moon' }).getByRole('button', { name: 'Start a mix' })).toBeVisible();
  }
  expect([...origins]).toEqual([new URL(page.url()).origin]);
  await useLayout(page, 'List view');
});

test('LX-0344-02 LX-0344-05 LX-0351-06 columns line up with their labels, targets are big enough and text has contrast, in both densities and themes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page);
  for (const density of ['Comfortable', 'Compact'] as const) {
    await page.getByRole('button', { name: density }).click();
    // each label starts where its column starts
    const guides = await page.evaluate(() => {
      const head = [...document.querySelectorAll('.library-column-head span')].map((node) => node.getBoundingClientRect().left);
      const row = document.querySelector('ul.library-rows > li')!;
      const cells = ['.song-name', '.song-columns', '.song-readiness', '.song-actions'].map((selector) => row.querySelector(selector)!.getBoundingClientRect().left);
      return head.map((left, index) => Math.abs(left - cells[index]));
    });
    expect(Math.max(...guides), density).toBeLessThanOrEqual(2);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const sizes = await page.evaluate(() => {
        const row = document.querySelector('ul.library-rows > li')!;
        const measure = (node: Element | null) => node && node.getBoundingClientRect();
        return {
          start: measure(row.querySelector('.song-actions button')),
          more: measure(row.querySelector('.menu > button')),
          check: measure(row.querySelector('.library-batch-check')),
          filters: [...document.querySelectorAll('.library-filters button')].map((node) => node.getBoundingClientRect().height),
        };
      });
      // Comfortable keeps 44px primary targets. Compact is the documented exception (ADR-0351):
      // a chosen desktop density whose targets stay above the WCAG 2.2 AA 24px minimum.
      const least = density === 'Comfortable' ? 44 : 24;
      for (const key of ['start', 'more', 'check'] as const) {
        expect(sizes[key]!.height, `${key} ${density} ${scheme}`).toBeGreaterThanOrEqual(least);
        expect(sizes[key]!.width, `${key} ${density} ${scheme}`).toBeGreaterThanOrEqual(least);
      }
      expect(Math.min(...sizes.filters)).toBeGreaterThanOrEqual(24);
      const ratios = await page.evaluate(() => {
        const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const parse = (text: string) => (text.match(/[\d.]+/g) ?? []).map(Number);
        const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        const background = (node: Element | null): number[] => {
          for (let at = node; at; at = at.parentElement) {
            const colour = parse(getComputedStyle(at).backgroundColor);
            if (colour.length >= 3 && (colour.length < 4 || colour[3] > 0.9)) return colour.slice(0, 3);
          }
          return [255, 255, 255];
        };
        const row = document.querySelector('ul.library-rows > li')!;
        return ['.song-open b', '.song-name > span[dir]', '.song-columns span', '.song-readiness .status', '.library-summary', '.library-readiness-help']
          .map((selector) => {
            const node = (selector.startsWith('.library-') ? document : row).querySelector(selector)!;
            const a = luminance(parse(getComputedStyle(node).color));
            const b = luminance(background(node));
            return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          });
      });
      for (const { selector, ratio } of ratios) expect(ratio, `${selector} ${density} ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Comfortable' }).click();
});

test('LX-0347-04 the confirmation lists each same-titled recording by ID with its flags, and a change elsewhere refuses the whole batch', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLibrary(page, '/library?q=Same%20Name');
  await rows(page).filter({ hasText: 'Hal Greene' }).getByRole('checkbox').check();
  await rows(page).filter({ hasText: 'Iris Vale' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Prioritize selected' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply batch Library action?' });
  await expect(dialog.getByText('Same Name - Hal Greene (ID 10; priority off; excluded no)')).toBeVisible();
  await expect(dialog.getByText('Same Name - Iris Vale (ID 11; priority off; excluded no)')).toBeVisible();
  // another tab prioritises recording 11 while this dialog is open
  await request.post('/api/songs/11/priority', { params: { priority: '100' } });
  try {
    await dialog.getByRole('button', { name: 'Confirm 2 recordings' }).click();
    await expect(page.getByText(/changed since selection/)).toBeVisible();
    const after = (await (await request.get('/api/library', { params: { q: 'Same Name', state: 'all' } })).json()).songs;
    expect(after.map((song: { id: number; priority: boolean }) => [song.id, song.priority]).sort()).toEqual([[10, false], [11, true]]);
  } finally {
    await request.post('/api/songs/11/priority', { params: { priority: '0' } });
  }
});

test('LX-0348-01 the sheet leads with the exact recording, whole long titles included', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openLibrary(page);
  await page.getByRole('button', { name: /^Details for An Extraordinarily Long Song Title/ }).click();
  const sheet = page.getByRole('dialog', { name: /^An Extraordinarily Long Song Title .*\(Extended Club Remix\)$/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Recording ID 8')).toBeVisible();
  const fits = await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  expect(fits).toBe(true);
  const first = await sheet.evaluate((node) => {
    const heading = node.querySelector('h2, h1, h3')!;
    const identity = node.querySelector('.song-details-identity')!;
    const facts = node.querySelector('.song-facts')!;
    return !!(heading.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !!(identity.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(first).toBe(true);
  expect(await reachable(sheet.getByRole('button', { name: 'Save correction' }))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: /^Details for An Extraordinarily Long Song Title/ })).toBeFocused();
});

test('LX-0350-02 overlapping cursor pages, a deep return and Show more give each recording exactly once', async ({ page }) => {
  let template: Record<string, unknown> | null = null;
  // each page overlaps the last by five recordings, as cursor pages can while analysis reorders songs
  const starts = [1, 96, 191, 286];
  await page.route('**/api/library?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q')) return route.fallback();
    if (!template) template = (await (await route.fetch()).json()).songs[0];
    const index = Number(url.searchParams.get('after') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const from = starts[index] ?? 1;
    const songs = Array.from({ length: Math.min(limit, 100) }, (_, offset) => ({ ...template, id: 500_000 + from + offset, title: `Cursor Recording ${from + offset}` }));
    await route.fulfill({ json: { songs, total: 400, next: index + 1 < starts.length ? String(index + 1) : null } });
  });
  await openLibrary(page, '/library?pages=3');
  const ids = () => page.locator('ul.library-rows > li .song-open').evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute('data-focus-key')!.replace('song-details-', ''))));
  await expect(rows(page)).toHaveCount(290);
  let seen = await ids();
  expect(new Set(seen).size, 'no recording appears twice').toBe(seen.length);
  expect(seen[0]).toBe(500_001);
  expect(seen.at(-1)).toBe(500_290);
  await page.getByRole('button', { name: 'Show more songs' }).click();
  await expect(rows(page)).toHaveCount(385);
  seen = await ids();
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen.at(-1)).toBe(500_385);
  await expect(page).toHaveURL(/pages=4/);
});

test('LX-0342-01 search is the largest Library control and the result count stays in view beside it', async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await openLibrary(page);
    const field = await box(search(page));
    const others = await page.locator('.library-find select, .library-find button, .library-filters button').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width));
    for (const other of others) expect(field.width, `search is wider than every other control at ${width}px`).toBeGreaterThan(other);
    const filters = await box(page.locator('.library-filters'));
    expect(field.y, 'search comes before the filters').toBeLessThan(filters.y);
    const count = await box(page.locator('.library-count'));
    expect(count.y + count.height, `the result count is on screen with the search at ${width}px`).toBeLessThanOrEqual(800);
    await search(page).fill('Same Name');
    await expect(page.locator('.library-count')).toHaveText('2 songs.');
    await expect(page.locator('.library-count')).toBeInViewport();
  }
});
