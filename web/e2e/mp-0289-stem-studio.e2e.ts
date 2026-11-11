import { expect, test, type Page } from '@playwright/test';
import { resetMix, spyOnAudio } from './helpers';

/**
 * ADR-0289 Stem Studio: rulers against the eight lanes at 8 and 64 cells, cell states, solo names,
 * the transport and audio focus, unapplied changes, sticky context while scrolling, and the list editor.
 * The e2e server never splits stems (tests/e2e_server.py sets stems to never), so the Studio session and
 * its stems are served here from a synthetic song, as finishing.e2e.ts does. Candidates for an
 * independent reviewer; nothing here proves how a transition sounds.
 */
type Lanes = { vocals: number[]; drums: number[]; bass: number[]; other: number[] };
const half = (cells: number) => Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
const shapeOf = (cells: number) => {
  const row = half(cells);
  const lanes: Lanes = { vocals: row, drums: row, bass: row, other: row };
  return { a: lanes, b: lanes };
};

/** A Studio for transition 1 with `cells` squares; `lost` names stems that fail to load. */
async function withStudio(page: Page, cells = 8, lost: string[] = []) {
  const shape = shapeOf(cells);
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  // the Studio opens its session with a POST to /mix/1/studio (tune and use have their own routes)
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: `mp289-${cells}`, cells, seconds: 8, bars: cells * 2, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), studio: { available: true } } });
  });
  await page.route('**/api/studio/**', (route) => {
    const [side, lane] = route.request().url().split('/').slice(-2);
    return lost.includes(`${side}_${lane}`) ? route.fulfill({ status: 404, body: 'gone' }) : route.fulfill({ body: stem, contentType: 'audio/flac' });
  });
}

async function openStudio(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
}

async function gridMode(page: Page) {
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  await expect(page.locator('.studio-grid')).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3]);
});

for (const cells of [8, 64]) {
  test(`MP-0289-01 lane names, bar ruler and all ${cells} cells line up`, async ({ page }) => {
    await withStudio(page, cells);
    await openStudio(page);
    await gridMode(page);
    const reading = await page.locator('.studio-grid').evaluate((grid) => {
      const centre = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.left + rect.width / 2; };
      const ruler = grid.querySelector('.studio-ruler')!;
      const heads = [...ruler.querySelectorAll('[role="columnheader"]')].slice(1);
      const lanes = [...grid.querySelectorAll('.studio-lane:not(.studio-ruler)')];
      return {
        labels: heads.map((head) => head.textContent),
        lanes: lanes.length,
        names: lanes.map((lane) => lane.querySelector('.studio-name')!.textContent),
        nameLefts: [ruler.querySelector('.studio-name')!, ...lanes.map((lane) => lane.querySelector('.studio-name')!)].map((name) => name.getBoundingClientRect().left),
        nameWidths: [ruler.querySelector('.studio-name')!, ...lanes.map((lane) => lane.querySelector('.studio-name')!)].map((name) => name.getBoundingClientRect().width),
        drift: lanes.map((lane) => {
          const squares = [...lane.querySelectorAll('.studio-cell')];
          return squares.length === heads.length ? Math.max(...squares.map((square, index) => Math.abs(centre(square) - centre(heads[index])))) : Infinity;
        }),
      };
    });
    expect(reading.lanes, 'eight lanes').toBe(8);
    expect(reading.names).toEqual(['Voice', 'Drums', 'Bass', 'Melody', 'Voice', 'Drums', 'Bass', 'Melody']);
    expect(reading.labels).toEqual(Array.from({ length: cells }, (_, index) => String(index * 2 + 1)));
    for (const drift of reading.drift) expect(drift, 'a cell is off its bar column').toBeLessThanOrEqual(1);
    for (const left of reading.nameLefts) expect(Math.abs(left - reading.nameLefts[0]), 'lane names off one edge').toBeLessThanOrEqual(1);
    for (const width of reading.nameWidths) expect(Math.abs(width - reading.nameWidths[0]), 'lane name widths differ').toBeLessThanOrEqual(1);
  });
}

test('MP-0289-02 on, off, playing, changed, missing and focused cells keep their shape and words', async ({ page }) => {
  await withStudio(page, 8, ['b_bass']);
  await openStudio(page);
  await gridMode(page);
  const on = page.getByRole('button', { name: /^.+ voice, .+, on$/ }).first();
  const off = page.getByRole('button', { name: /^.+ voice, .+, off$/ }).first();
  const missing = page.locator('.studio-lane.lost .studio-cell').first();
  await expect(page.locator('.studio-lane.lost')).toHaveCount(1);
  await expect(missing).toHaveAttribute('aria-label', /, unavailable$/);
  await expect(missing).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.studio-lane.lost .studio-name')).toHaveAttribute('aria-label', /bass, unavailable$/);
  await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t load' })).toBeVisible();
  const look = (selector: string) => page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    const mark = getComputedStyle(element, '::after');
    const rect = element.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), mark: mark.content !== 'none' && mark.content !== '', shadow: style.boxShadow, image: style.backgroundImage, outline: style.outlineStyle, cursor: style.cursor };
  });
  await expect(on).toBeVisible();
  const onLook = await look('.studio-cell[aria-pressed="true"]');
  const offLook = await look('.studio-cell[aria-pressed="false"]');
  const lostLook = await look('.studio-lane.lost .studio-cell');
  // same square everywhere; what it means is drawn, not only coloured
  expect([offLook.width, offLook.height]).toEqual([onLook.width, onLook.height]);
  expect([lostLook.width, lostLook.height]).toEqual([onLook.width, onLook.height]);
  expect(onLook.mark, 'an on square has no mark').toBe(true);
  expect(offLook.mark, 'an off square has a mark').toBe(false);
  expect(lostLook.image, 'a missing square has no hatching').toContain('repeating-linear-gradient');
  expect(lostLook.cursor).toBe('not-allowed');
  // focus: a visible ring inside the square, and the words still say on or off
  await off.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  const focused = await page.evaluate(() => {
    const element = document.activeElement!;
    const style = getComputedStyle(element);
    return { label: element.getAttribute('aria-label'), outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focused.label).toMatch(/, (on|off)$/);
  expect(focused.outline).not.toBe('none');
  expect(focused.width).toBeGreaterThanOrEqual(2);
  // pressing changes the words and the mark together
  const name = (await off.getAttribute('aria-label'))!;
  await page.getByRole('button', { name, exact: true }).press('Space');
  await expect(page.getByRole('button', { name: name.replace(/off$/, 'on'), exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('MP-0289-03 Voice, Drums, Bass and Melody names and their solo buttons stay level with their lanes', async ({ page }) => {
  await withStudio(page, 16);
  await openStudio(page, 375, 812);
  await gridMode(page);
  const rows = await page.locator('.studio-lane:not(.studio-ruler)').evaluateAll((lanes) => lanes.map((lane) => {
    const name = lane.querySelector('.studio-name')!.getBoundingClientRect();
    const first = lane.querySelector('.studio-cell')!.getBoundingClientRect();
    return { nameMid: name.top + name.height / 2, cellMid: first.top + first.height / 2, nameHeight: name.height, cellHeight: first.height, overlap: name.right - first.left };
  }));
  for (const row of rows) {
    expect(Math.abs(row.nameMid - row.cellMid), 'a lane name is not level with its squares').toBeLessThanOrEqual(1);
    expect(row.nameHeight).toBeGreaterThanOrEqual(44);
    expect(row.overlap, 'a lane name runs into its first square').toBeLessThanOrEqual(0);
  }
  // a solo name says so, and only that lane stays at full strength
  const drums = page.getByRole('button', { name: /^Hear only .+ drums$/ }).first();
  await drums.click();
  await expect(drums).toHaveAttribute('aria-pressed', 'true');
  await expect(drums).toHaveText('Solo: Drums');
  await expect(page.locator('.studio-lane.soloed')).toHaveCount(1);
  await expect(page.locator('.studio-lane.silenced')).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Hear everything again' })).toBeVisible();
  const level = await page.locator('.studio-lane.soloed').evaluate((lane) => {
    const name = lane.querySelector('.studio-name')!.getBoundingClientRect();
    const first = lane.querySelector('.studio-cell')!.getBoundingClientRect();
    return Math.abs((name.top + name.height / 2) - (first.top + first.height / 2));
  });
  expect(level, 'the solo label moved off its lane').toBeLessThanOrEqual(1);
});

test('MP-0289-04 Play and Stop preview lead the Studio and hold the one audio focus', async ({ page }) => {
  await spyOnAudio(page);
  await withStudio(page, 8);
  // the main mix is playing first
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  // into the editor without a reload, so the mix keeps playing
  await page.evaluate(() => { window.history.pushState({}, '', '/mix/current/edit'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.mini')).toHaveAttribute('aria-label', /Now playing|Playing transition/);
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  const transport = page.locator('.studio-transport .primary');
  await expect(transport).toHaveText(/Play preview/);
  await expect(transport.locator('svg[data-icon="play"]')).toHaveCount(1);
  const head = await page.locator('.studio-head').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const button = element.querySelector('.studio-transport .primary')!.getBoundingClientRect();
    return { headTop: rect.top, headBottom: rect.bottom, top: button.top, bottom: button.bottom, height: button.height };
  });
  expect(head.top).toBeGreaterThanOrEqual(head.headTop);
  expect(head.bottom).toBeLessThanOrEqual(head.headBottom + 1);
  expect(head.height).toBeGreaterThanOrEqual(44);
  const started = await page.evaluate(() => window.audioSpy.started.length);
  await transport.click();
  await expect(transport).toHaveText(/Stop preview/);
  await expect(transport.locator('svg[data-icon="stop"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.audioSpy.started.length)).toBeGreaterThan(started);
  // the Studio took the focus: the main mix is paused, not playing underneath
  await expect(page.locator('.mini')).toHaveAttribute('aria-label', 'Paused playback');
  await transport.click();
  await expect(transport).toHaveText(/Play preview/);
  // stopping does not start the mix again by itself
  await expect(page.locator('.mini')).toHaveAttribute('aria-label', 'Paused playback');
});

test('MP-0289-05 working copy, applied shape, suggestion and reset look different', async ({ page }) => {
  await withStudio(page, 8);
  const suggested = shapeOf(8);
  suggested.a = { ...suggested.a, drums: [1, 1, 1, 1, 1, 1, 1, 1] };
  await page.route('**/api/mix/1/studio/tune*', (route) => route.fulfill({ json: { shape: suggested, changes: ['Kept the drums of the first song going all the way.'] } }));
  await openStudio(page);
  await gridMode(page);
  const working = page.locator('.studio-states > div').filter({ hasText: 'Working copy' });
  const applied = page.locator('.studio-states > div').filter({ hasText: 'Applied to the mix' });
  const border = (locator: typeof working) => locator.evaluate((element) => getComputedStyle(element).borderTopColor);
  await expect(working).not.toHaveClass(/\bon\b/);
  await expect(page.locator('.studio-save-state')).toHaveText(/Showing the saved transition/);
  const calm = await border(working);
  // a local change: the working copy says so in words and in its edge, the applied shape does not move
  await page.locator('.studio-cell[aria-pressed="false"]').first().click();
  await expect(working).toHaveClass(/\bon\b/);
  await expect(working.locator('dd')).toHaveText('Changed, not applied yet');
  await expect(page.locator('.studio-save-state')).toHaveText(/Unsaved changes - not applied to the mix/);
  expect(await border(working)).not.toBe(calm);
  expect(await border(applied)).toBe(calm);
  // a suggestion marks each square it changed, differently from on and off, and lists them
  const arrange = page.getByRole('button', { name: 'Let Selecta arrange it' });
  if (await arrange.count()) {
    await arrange.click();
    await expect(page.locator('.studio-cell.ai-changed').first()).toBeVisible();
    const marked = await page.locator('.studio-cell.ai-changed').first().evaluate((element) => getComputedStyle(element).boxShadow);
    const plain = await page.locator('.studio-cell:not(.ai-changed)').first().evaluate((element) => getComputedStyle(element).boxShadow);
    expect(marked).not.toBe(plain);
    await expect(page.locator('.studio-diff summary')).toContainText('exact cell');
    await expect(page.getByRole('button', { name: 'Put it back' })).toBeVisible();
  }
  // Apply is the one primary action; Start again is quieter and returns to what is applied
  const apply = page.getByRole('button', { name: 'Apply to this transition' });
  const again = page.getByRole('button', { name: 'Start again' });
  const fill = (locator: typeof apply) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await fill(apply)).not.toBe(await fill(again));
  await again.click();
  await expect(working).not.toHaveClass(/\bon\b/);
  await expect(page.locator('.studio-save-state')).toHaveText(/Showing the saved transition/);
});

test('MP-0289-06 the ruler and lane names stay put while the grid scrolls, at phone size and zoomed', async ({ page }) => {
  await withStudio(page, 64);
  for (const [width, height] of [[375, 812], [640, 400]] as const) {
    await openStudio(page, width, height);
    await gridMode(page);
    const grid = page.locator('.studio-grid');
    const reading = await grid.evaluate(async (element) => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = element.scrollHeight;
      await frame();
      await frame();
      const box = element.getBoundingClientRect();
      const ruler = element.querySelector('.studio-ruler')!.getBoundingClientRect();
      const corner = element.querySelector('.studio-ruler .studio-name')!.getBoundingClientRect();
      const names = [...element.querySelectorAll('.studio-lane:not(.studio-ruler) .studio-name')].map((name) => name.getBoundingClientRect());
      const visible = names.filter((name) => name.bottom > ruler.bottom && name.top < box.bottom);
      return {
        scrolled: element.scrollLeft > 0,
        rulerTop: ruler.top - box.top,
        cornerLeft: corner.left - box.left,
        nameLefts: visible.map((name) => name.left - box.left),
        nameCount: visible.length,
      };
    });
    expect(reading.scrolled, `${width}px: the grid did not scroll sideways`).toBe(true);
    expect(Math.abs(reading.rulerTop), `${width}px: the ruler scrolled away`).toBeLessThanOrEqual(2);
    expect(Math.abs(reading.cornerLeft), `${width}px: the Bar corner scrolled away`).toBeLessThanOrEqual(2);
    expect(reading.nameCount, `${width}px: no lane name visible after scrolling`).toBeGreaterThan(0);
    for (const left of reading.nameLefts) expect(Math.abs(left), `${width}px: a lane name scrolled away`).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${width}px: the page scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

test('MP-0289-07 the list editor covers the same cells, with the same values and names', async ({ page }) => {
  await withStudio(page, 8, ['a_other']);
  await openStudio(page);
  await gridMode(page);
  const gridCells = await page.locator('.studio-cell').evaluateAll((cells) => cells.map((cell) => ({ id: cell.getAttribute('data-cell'), on: cell.getAttribute('aria-pressed') === 'true', lost: cell.getAttribute('aria-disabled') === 'true' })));
  expect(gridCells).toHaveLength(64);
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed list' }).click();
  const list = page.locator('.studio-list');
  await expect(list).toBeVisible();
  const listCells = await list.locator('input[type="checkbox"]').evaluateAll((boxes) => boxes.map((box) => ({ id: box.getAttribute('data-cell'), on: (box as HTMLInputElement).checked, lost: (box as HTMLInputElement).disabled })));
  expect(listCells).toEqual(gridCells);
  // every part is a named group under its song, every square a named checkbox
  await expect(list.locator('section h4')).toHaveCount(2);
  await expect(list.locator('fieldset legend')).toHaveText(['Voice', 'Drums', 'Bass', 'Melody - unavailable', 'Voice', 'Drums', 'Bass', 'Melody']);
  const first = list.locator('fieldset').first().getByRole('checkbox').first();
  await expect(first).toHaveAccessibleName(/bar/i);
  const before = await first.isChecked();
  await first.press('Space');
  await expect(first).toBeChecked({ checked: !before });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  await expect(page.locator('.studio-cell[data-cell="0-0"]')).toHaveAttribute('aria-pressed', String(!before));
  // the list fits a phone without sideways scrolling, each square a full target
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed list' }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const heights = await list.locator('.studio-list-cells label').evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

test('MP-0289-08 (automated part) solo, edit, preview, leave, return and Apply keep the exact pair', async ({ page }) => {
  await withStudio(page, 8);
  let applied: { url: string; body: unknown } | null = null;
  await page.route('**/api/mix/1/studio/use*', async (route) => {
    applied = { url: route.request().url(), body: route.request().postDataJSON() };
    await route.fallback();
  });
  await openStudio(page);
  const pair = await page.locator('.studio-pair p b').allTextContents();
  await gridMode(page);
  await page.getByRole('button', { name: /^Hear only .+ voice$/ }).first().click();
  const cell = page.locator('.studio-cell[data-cell="0-7"]');
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.studio-transport .primary').click();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.locator('.studio')).toHaveCount(0);
  // back again: the same pair, and the edit recovered from this browser
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-pair p b')).toHaveText(pair);
  await expect(page.locator('.studio-states > div').filter({ hasText: 'Recovered from this browser' }).locator('dd')).toHaveText('Yes, your earlier work');
  await gridMode(page);
  await expect(page.locator('.studio-cell[data-cell="0-7"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Apply to this transition' }).click();
  await expect.poll(() => applied).not.toBeNull();
  expect(applied!.url).toContain('/api/mix/1/studio/use');
  expect((applied!.body as { shape: { a: Lanes } }).shape.a.vocals[7]).toBe(1);
});
