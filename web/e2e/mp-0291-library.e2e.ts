import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * ADR-0291 Library: toolbar anchors, column headers against rows, both densities, readiness labels,
 * the selection rail, song corrections, and a 20,000-song library paged without layout jumps.
 * Measured in Edge against tests/e2e_server.py; candidates for an independent reviewer.
 */
async function open(page: Page, width: number, path = '/library', height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await expect(page.locator('.library-rows .song-row').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0291-01 search, sort, density, filters and the count share clean anchors', async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await open(page, width);
    const reading = await page.evaluate(() => {
      const box = (selector: string) => { const element = document.querySelector(selector); if (!element) return null; const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height }; };
      const find = box('.library-find')!;
      const controls = ['.library-find .search-field input, .library-find input', '.library-sort select', '.library-density button'].map((selector) => box(selector));
      const sortWords = box('.library-sort');
      return {
        find,
        filters: box('.library-filters'),
        count: box('.library-count'),
        rows: box('.library-rows'),
        controls,
        sortWords,
        filterHeights: [...document.querySelectorAll('.library-filters button')].map((button) => button.getBoundingClientRect().height),
        densityHeights: [...document.querySelectorAll('.library-density button')].map((button) => button.getBoundingClientRect().height),
      };
    });
    const where = `${width}px`;
    // one left edge for the toolbar, the filters, the count and the rows
    for (const name of ['filters', 'count', 'rows'] as const) {
      expect(Math.abs(reading[name]!.left - reading.find.left), `${where}: ${name} starts off the toolbar edge`).toBeLessThanOrEqual(1);
    }
    // the toolbar's controls share one height, and on a wide screen one baseline
    const heights = reading.controls.filter(Boolean).map((control) => control!.height);
    for (const height of heights) expect(Math.abs(height - heights[0]), `${where}: toolbar controls differ in height`).toBeLessThanOrEqual(1);
    for (const height of [...reading.filterHeights, ...reading.densityHeights]) expect(height, `${where}: a toolbar target is under 44px`).toBeGreaterThanOrEqual(44);
    if (width >= 1024) {
      const bottoms = reading.controls.filter(Boolean).map((control) => control!.bottom);
      for (const bottom of bottoms) expect(Math.abs(bottom - bottoms[0]), `${where}: toolbar controls not on one line`).toBeLessThanOrEqual(1);
    }
    // the count sits after the filters, before the rows
    expect(reading.count!.top).toBeGreaterThanOrEqual(reading.filters!.bottom - 1);
    expect(reading.count!.bottom).toBeLessThanOrEqual(reading.rows!.top + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${where}: page scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

test('MP-0291-02 track, facts, readiness and actions headers sit over their columns', async ({ page }) => {
  for (const width of [1100, 1440, 1920]) {
    await open(page, width);
    const reading = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.library-column-head span')].map((span) => span.getBoundingClientRect());
      const rows = [...document.querySelectorAll('.library-rows .song-row')].slice(0, 8).map((row) => ['.song-name', '.song-columns', '.song-readiness', '.song-actions'].map((selector) => row.querySelector(selector)!.getBoundingClientRect()));
      return { heads: heads.map((head) => ({ left: head.left, right: head.right })), rows: rows.map((cells) => cells.map((cell) => ({ left: cell.left, right: cell.right }))) };
    });
    expect(reading.heads, `${width}px: four column headers`).toHaveLength(4);
    for (const cells of reading.rows) {
      for (let column = 0; column < 3; column += 1) {
        expect(Math.abs(cells[column].left - reading.heads[column].left), `${width}px: column ${column + 1} starts off its header`).toBeLessThanOrEqual(1);
      }
      // actions end on the header's right edge, as both are aligned to the end
      expect(Math.abs(cells[3].right - reading.heads[3].right), `${width}px: actions end off their header`).toBeLessThanOrEqual(1);
    }
  }
  // narrower, the header would no longer describe the layout, so it is hidden rather than wrong
  await open(page, 768);
  await expect(page.locator('.library-column-head')).toBeHidden();
});

test('MP-0291-03 comfortable and compact rows stay readable with safe targets', async ({ page, browser }) => {
  const sizes: Record<string, number> = {};
  for (const density of ['Comfortable', 'Compact']) {
    for (const width of [375, 1440]) {
      await open(page, width);
      await page.getByRole('group', { name: 'Row size' }).getByRole('button', { name: density }).click();
      await expect(page.getByRole('group', { name: 'Row size' }).getByRole('button', { name: density })).toHaveAttribute('aria-pressed', 'true');
      const reading = await page.locator('.library-rows .song-row').first().evaluate((row) => {
        const title = row.querySelector('.song-open b')!;
        const facts = row.querySelector('.song-columns')!;
        // a checkbox's target is its whole label (operations.css gives that the 44px), not the smaller box drawn inside it
        const targets = [...row.querySelectorAll('button, input')].filter((element) => (element as HTMLElement).offsetParent !== null).map((element) => (element.matches('input[type=checkbox]') ? element.closest('label') ?? element : element).getBoundingClientRect());
        return {
          height: row.getBoundingClientRect().height,
          title: parseFloat(getComputedStyle(title).fontSize),
          facts: parseFloat(getComputedStyle(facts).fontSize),
          lineHeight: parseFloat(getComputedStyle(title).lineHeight) / parseFloat(getComputedStyle(title).fontSize),
          smallest: Math.min(...targets.map((target) => Math.min(target.height, target.width))),
        };
      });
      expect(reading.title, `${density} ${width}px: title too small`).toBeGreaterThanOrEqual(14);
      expect(reading.facts, `${density} ${width}px: facts too small`).toBeGreaterThanOrEqual(12);
      expect(reading.lineHeight).toBeGreaterThanOrEqual(1.2);
      expect(reading.smallest, `${density} ${width}px: a row target is too small`).toBeGreaterThanOrEqual(24);
      sizes[`${density}-${width}`] = reading.height;
    }
  }
  // compact really is denser at the same width
  expect(sizes['Compact-1440']).toBeLessThan(sizes['Comfortable-1440']);
  // the row's main actions stay at least 44px on a touch screen in either density: a real touch
  // screen (a coarse pointer, which tokens.css answers), not only a narrow window
  const touch = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
  const phone = await touch.newPage();
  try {
    await phone.emulateMedia({ reducedMotion: 'reduce' });
    await open(phone, 375, '/library', 812);
    for (const density of ['Comfortable', 'Compact']) {
      await phone.getByRole('group', { name: 'Row size' }).getByRole('button', { name: density }).click();
      await expect(phone.getByRole('group', { name: 'Row size' }).getByRole('button', { name: density })).toHaveAttribute('aria-pressed', 'true');
      const actions = await phone.locator('.library-rows .song-row').first().locator('.song-actions button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
      for (const height of actions) expect(height, `${density} on a touch screen`).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await touch.close();
  }
});

test('MP-0291-04 loading, ready, attention, missing and excluded read as different states', async ({ page }) => {
  const statuses = ['mix_ready', 'analysed_incomplete', 'needs_attention', 'missing', 'excluded', 'queued', 'processing'];
  let hold: Promise<void> | null = new Promise(() => undefined);
  await page.route('**/api/library?**', async (route: Route) => {
    const answer = await route.fetch();
    const data = await answer.json();
    data.songs = data.songs.slice(0, statuses.length).map((song: Record<string, unknown>, index: number) => ({ ...song, readiness: { status: statuses[index], reason: index === 2 ? 'The file could not be decoded.' : '' } }));
    data.total = data.songs.length;
    data.next = null;
    if (hold) await Promise.race([hold, new Promise((resolve) => setTimeout(resolve, 1500))]);
    await route.fulfill({ response: answer, json: data });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library');
  // loading has its own words before any row exists
  await expect(page.getByRole('status').filter({ hasText: 'Loading your songs' }).or(page.locator('[aria-label="Loading your songs"]')).first()).toBeAttached();
  hold = null;
  await expect(page.locator('.library-rows .song-row')).toHaveCount(statuses.length, { timeout: 30_000 });
  const states = await page.locator('.library-rows .song-readiness .status').evaluateAll((badges) => badges.map((badge) => ({ words: badge.textContent?.trim(), kind: badge.className })));
  expect(states.map((state) => state.words)).toEqual(['Ready for mixes', 'Not ready for mixes', 'Couldn’t be analysed', 'File is missing', 'Never plays', 'Waiting to be analysed', 'Being analysed']);
  expect(new Set(states.map((state) => state.words)).size).toBe(statuses.length);
  // ready, attention and unavailable are drawn differently, not only named differently
  expect(states[0].kind).not.toBe(states[2].kind);
  expect(states[2].kind).not.toBe(states[4].kind);
  // the reason for a problem is right under its badge
  await expect(page.locator('.library-rows .song-row').nth(2).locator('.song-why')).toHaveText('The file could not be decoded.');
});

test('MP-0291-05 the batch rail appears only with a real selection, with the right count and scope', async ({ page }) => {
  await open(page, 1440);
  const boxes = page.locator('.library-batch-check input');
  test.skip(await boxes.count() === 0, 'library.batch is off in this build');
  const rail = page.locator('.library-batch-actions');
  await expect(rail).toHaveCount(0);
  const loaded = await page.locator('.library-rows .song-row').count();
  await boxes.nth(0).check();
  await boxes.nth(2).check();
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('status')).toContainText(`2 of ${loaded} loaded recordings selected (limit 200)`);
  await expect(page.locator('.library-rows .song-row.selected')).toHaveCount(2);
  // the rail sits between the toolbar and the rows, so it never covers a row being picked
  const railBox = await rail.boundingBox();
  const rowsBox = await page.locator('.library-rows').boundingBox();
  expect(railBox!.y + railBox!.height).toBeLessThanOrEqual(rowsBox!.y + 1);
  await rail.getByRole('button', { name: 'Clear selection' }).click();
  await expect(rail).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select up to 200 loaded songs' })).toBeFocused();
  // a filter change is a new scope, so a selection does not survive it
  await boxes.nth(1).check();
  await expect(rail).toBeVisible();
  await page.getByRole('group', { name: 'Filter Library recordings' }).getByRole('button').nth(1).click();
  await expect(rail).toHaveCount(0);
});

test('MP-0291-06 measured values, your correction, its error and the way back fit together', async ({ page, request }) => {
  const songs = (await (await request.get('/api/library?q=&state=all&sort=title&limit=5')).json()).songs as { id: number; bpm: number | null }[];
  const song = songs.find((one) => one.bpm !== null)!;
  await request.post(`/api/songs/${song.id}/correct`, { data: { bpm: 100 } });
  await open(page, 768, `/library?song=${song.id}`);
  const details = page.getByRole('dialog').last();
  await expect(details.getByText('Tempo in use')).toBeVisible();
  // in use and measured are separate rows of one list, labelled the same way, and the correction says it is yours
  // the facts list, not the "What it's ready for" list above it (library.capability_readiness)
  const facts = await details.locator('dl', { hasText: 'Tempo in use' }).evaluate((list) => [...list.querySelectorAll(':scope > div')].map((row) => {
    const dt = row.querySelector('dt')!.getBoundingClientRect();
    const dd = row.querySelector('dd')!.getBoundingClientRect();
    return { label: row.querySelector('dt')!.textContent, value: row.querySelector('dd')!.textContent, dtLeft: dt.left, ddLeft: dd.left };
  }));
  const tempoInUse = facts.find((row) => row.label === 'Tempo in use')!;
  const tempoMeasured = facts.find((row) => row.label === 'Tempo measured')!;
  expect(tempoInUse.value).toContain('(your correction)');
  expect(tempoMeasured.value).not.toContain('your correction');
  for (const row of facts) {
    expect(Math.abs(row.dtLeft - facts[0].dtLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(row.ddLeft - facts[0].ddLeft)).toBeLessThanOrEqual(1);
  }
  // a bad value: the error sits right under its own field, and Save and the way back stay together
  const tempo = details.getByRole('textbox', { name: /^Tempo/ }).or(details.getByRole('spinbutton', { name: /^Tempo/ })).first();
  await tempo.fill('400');
  await details.getByRole('button', { name: 'Save correction' }).click();
  const error = details.locator('.correct-field').first().locator('[id$="-error"], .field-error, .warn').first();
  await expect(error).toBeVisible();
  await expect(tempo).toHaveAttribute('aria-invalid', 'true');
  const fieldBox = await tempo.boundingBox();
  const errorBox = await error.boundingBox();
  expect(errorBox!.y - (fieldBox!.y + fieldBox!.height), 'the error is far from its field').toBeLessThanOrEqual(32);
  expect(errorBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height - 1);
  const save = await details.getByRole('button', { name: 'Save correction' }).boundingBox();
  const back = await details.getByRole('button', { name: 'Use what was measured' }).boundingBox();
  expect(Math.abs(save!.y - back!.y), 'Save and Use what was measured are apart').toBeLessThanOrEqual(back!.height);
  await request.post(`/api/songs/${song.id}/correct`, { data: { clear: ['bpm', 'camelot'] } });
});

test('MP-0291-07 a 20,000-song library pages, searches and keeps focus without jumping', async ({ page }) => {
  const TOTAL = 20_000;
  let template: Record<string, unknown> | null = null;
  await page.route('**/api/library?**', async (route) => {
    const url = new URL(route.request().url());
    if (!template) {
      const answer = await route.fetch();
      template = (await answer.json()).songs[0];
    }
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const after = Number(url.searchParams.get('after') ?? 0);
    const q = url.searchParams.get('q') ?? '';
    const total = q ? 1200 : TOTAL;
    const songs = Array.from({ length: Math.min(limit, total - after) }, (_, index) => {
      const id = 100_000 + after + index;
      return { ...template, id, title: `${q ? `${q} ` : ''}Synthetic Recording ${after + index + 1}`, artist: `Artist ${(after + index) % 300}` };
    });
    await route.fulfill({ json: { songs, total, next: after + limit < total ? String(after + limit) : null } });
  });
  await open(page, 1440);
  await expect(page.locator('.library-count')).toHaveText('Showing 100 of 20000 songs.');
  // loading more keeps what is on screen exactly where it was, and the button keeps the focus
  const more = page.getByRole('button', { name: 'Show more songs' });
  const anchor = page.locator('.library-rows .song-row').nth(40);
  await anchor.scrollIntoViewIfNeeded();
  // where the row sits on screen, which is what a jump would move. Show more is focused without
  // scrolling to it, so the row stays in view: rows far above that were never drawn are only size
  // estimates (content-visibility), and the browser's scroll anchoring keeps what's on screen still
  // while those settle, so a page-relative position would move by the estimate, not by a jump
  const screenTop = () => anchor.evaluate((element) => element.getBoundingClientRect().top);
  // The rows that just came into view are drawn a frame or more after the scroll, taking their real
  // height in place of the estimate, so the starting place is read only once the row has stayed put
  // for several frames (a slow machine takes longer to get there)
  await anchor.evaluate((element) => new Promise<void>((settled) => {
    let last = '';
    let still = 0;
    const check = () => {
      const now = `${window.scrollY}:${element.getBoundingClientRect().top}`;
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= 10) settled();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
  const before = await screenTop();
  for (let round = 0; round < 3; round += 1) {
    await more.evaluate((button) => button.focus({ preventScroll: true }));
    const started = Date.now();
    await page.keyboard.press('Enter');
    await expect(page.locator('.library-rows .song-row')).toHaveCount(200 + round * 100);
    expect(Date.now() - started, 'a page took too long to show').toBeLessThan(3000);
    await expect(more).toBeFocused();
  }
  const after = await screenTop();
  expect(Math.abs(after - before), 'rows already shown moved').toBeLessThanOrEqual(1);
  // a layout shift observer sees nothing big while a search narrows the list
  await page.evaluate(() => {
    (window as unknown as { shift: number }).shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) (window as unknown as { shift: number }).shift += entry.value;
    }).observe({ type: 'layout-shift', buffered: false });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  const search = page.getByRole('searchbox', { name: 'Search your library' }).or(page.getByRole('textbox', { name: 'Search your library' })).first();
  const started = Date.now();
  await search.fill('Night');
  await expect(page.locator('.library-count')).toHaveText('Showing 100 of 1200 songs.');
  expect(Date.now() - started, 'search took too long').toBeLessThan(3000);
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { shift: number }).shift), 'the page jumped while searching').toBeLessThan(0.1);
});
