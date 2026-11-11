import { expect, test, type Page } from '@playwright/test';
import { audioClock, resetMix, soundsRestarted, spyOnAudio } from './helpers';

/**
 * ADR-0287 editor timeline: the song grid, seams between their pair, reorder targets, object states,
 * exact occurrence, add-gap targets, the pinned scope bar and a 100-song mix. Measured in Edge from the
 * real stylesheet against tests/e2e_server.py. Candidates for an independent reviewer.
 */
const WIDTHS = [320, 768, 1440] as const;
const order = async (page: Page) => ((await (await page.request.get('/api/mix')).json()).mix as { title: string }[]).map((song) => song.title);

async function open(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/mix/current/edit');
  await expect(page.locator('.timeline .song').first()).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0287-01 grip, number, motif and title, facts and actions keep one column each down the timeline', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3, 4, 1]);
  for (const width of WIDTHS) {
    await open(page, width);
    const rows = await page.locator('.timeline > .song').evaluateAll((songs) => songs.map((song) => {
      const at = (selector: string) => song.querySelector(selector)!.getBoundingClientRect();
      return {
        grip: at('.grip').left, count: at('.count').right, motif: at('.song-name .song-motif, .song-name svg').left,
        name: at('.song-name').left, facts: at('.facts').left, actions: at('.song-actions').right,
        countToName: at('.song-name').left - at('.count').right,
      };
    }));
    expect(rows.length).toBe(5);
    for (const row of rows) {
      for (const column of ['grip', 'count', 'motif', 'name', 'facts', 'actions'] as const) {
        expect(Math.abs(row[column] - rows[0][column]), `${width}px: ${column} column wanders`).toBeLessThanOrEqual(1);
      }
      expect(row.countToName, `${width}px: number touches the name`).toBeGreaterThan(4);
    }
  }
});

test('MP-0287-02 each transition hangs between its own two songs, on the timeline rail', async ({ page, request }) => {
  await resetMix(request);
  for (const width of WIDTHS) {
    await open(page, width);
    const items = await page.locator('.timeline > li').evaluateAll((all) => all.map((item) => {
      const box = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return { kind: item.classList.contains('song') ? 'song' : item.classList.contains('seam') ? 'seam' : 'other', top: box.top, bottom: box.bottom, left: box.left, right: box.right, rail: style.borderLeftWidth, name: item.querySelector('.song-select b')?.textContent ?? '' };
    }));
    const songs = items.filter((item) => item.kind === 'song');
    const seams = items.filter((item) => item.kind === 'seam');
    expect(seams.length, `${width}px: one seam per pair`).toBe(songs.length - 1);
    for (let index = 0; index < items.length; index += 1) {
      if (items[index].kind !== 'seam') continue;
      const before = items.slice(0, index).reverse().find((item) => item.kind === 'song')!;
      const after = items.slice(index + 1).find((item) => item.kind === 'song')!;
      const seam = items[index];
      expect(seam.top, `${width}px: seam overlaps the song above`).toBeGreaterThanOrEqual(before.bottom - 1);
      expect(seam.bottom, `${width}px: seam overlaps the song below`).toBeLessThanOrEqual(after.top + 1);
      expect(after.top - before.bottom - (seam.bottom - seam.top), `${width}px: loose seam`).toBeLessThanOrEqual(48);
      // indented under the song above, on a visible rail, never wider than the songs
      expect(seam.left, `${width}px: seam not nested`).toBeGreaterThan(before.left);
      expect(seam.right, `${width}px: seam past the songs`).toBeLessThanOrEqual(before.right + 1);
      expect(parseFloat(seam.rail), `${width}px: no rail`).toBeGreaterThanOrEqual(2);
    }
  }
});

test('MP-0287-03 the grip and move buttons stay full targets at 320px, and drag and keyboard both move', async ({ page, request }) => {
  await resetMix(request);
  await open(page, 320, 740);
  const sizes = await page.locator('.timeline > .song').first().evaluate((row) => ['.grip', '[data-move="up"]', '[data-move="down"]'].map((selector) => {
    const box = row.querySelector(selector)!.getBoundingClientRect();
    return { selector, width: box.width, height: box.height, right: box.right };
  }));
  for (const size of sizes) {
    expect(size.width, `${size.selector} width`).toBeGreaterThanOrEqual(44);
    expect(size.height, `${size.selector} height`).toBeGreaterThanOrEqual(36);
    expect(size.right, `${size.selector} off screen`).toBeLessThanOrEqual(320);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'sideways scroll').toBeLessThanOrEqual(320);
  // keyboard: Space picks up, an arrow moves, focus stays on the moved song
  const grip = page.getByRole('button', { name: 'Reorder Morning Light' });
  await grip.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => order(page)).toEqual(['Slow Tide', 'Morning Light', 'Paper Moon', 'Neon Rain']);
  await expect(page.getByRole('button', { name: 'Reorder Morning Light' })).toBeFocused();
  // pointer: drag the grip of the last song onto the first
  const from = (await page.getByRole('button', { name: 'Reorder Neon Rain' }).boundingBox())!;
  const to = (await page.locator('.timeline > .song').first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(from.x + from.width / 2, from.y + ((to.y + 8 - from.y) * step) / 12);
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(['Neon Rain', 'Slow Tide', 'Morning Light', 'Paper Moon']);
});

test('MP-0287-04 selected, focused, locked, playing and pending each have their own mark', async ({ page, request }) => {
  await spyOnAudio(page);
  await resetMix(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(async () => (await audioClock(page))[0] ?? 0).toBeGreaterThan(0.2);
  await open(page, 1440);
  const rows = page.locator('.timeline > .song');
  await rows.nth(1).locator('.song-select').click();
  const more = rows.nth(2).getByRole('button', { name: /More for/ });
  if (await more.count()) {
    await more.click();
    const lock = page.getByRole('menuitem', { name: 'Lock' });
    if (await lock.count()) await lock.click();
    else await page.keyboard.press('Escape');
  }
  await rows.nth(3).locator('.grip').focus();
  const look = await rows.evaluateAll((songs) => songs.map((song) => {
    const style = getComputedStyle(song);
    return {
      classes: song.className, shadow: style.boxShadow, background: style.backgroundColor,
      tag: song.querySelector('.story-tag.playing')?.textContent ?? null, locked: song.querySelector('.locked-badge')?.textContent ?? null,
    };
  }));
  const playing = look[0];
  const selected = look[1];
  const plain = look[3];
  expect(playing.classes).toContain('playing');
  expect(playing.tag, 'playing says so in words').toMatch(/Playing now/);
  expect(selected.classes).toContain('selected');
  expect(selected.shadow, 'selected ring differs from playing marker').not.toBe(playing.shadow);
  expect(selected.background, 'selected surface').not.toBe(plain.background);
  expect(plain.shadow === 'none' || plain.shadow !== selected.shadow).toBe(true);
  if (look[2].locked !== null) expect(look[2].locked).toMatch(/Locked/);
  const focus = await rows.nth(3).locator('.grip').evaluate((grip) => ({ style: getComputedStyle(grip).outlineStyle, width: getComputedStyle(grip).outlineWidth }));
  expect(focus.style, 'focus ring').not.toBe('none');
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
  // pending transitions carry their own words, not a colour alone
  const pills = await page.locator('.timeline .seam .pill').allTextContents();
  expect(pills.length).toBeGreaterThan(0);
  for (const pill of pills) expect(pill.trim().length, 'seam status in words').toBeGreaterThan(2);
  // both at once keeps both marks
  await rows.first().locator('.song-select').click();
  const both = await rows.first().evaluate((song) => getComputedStyle(song).boxShadow);
  expect(both, 'selected and playing keep two marks').toContain(',');
});

test('MP-0287-05 a repeated song keeps its own selection and identity through a move', async ({ page, request }) => {
  await resetMix(request, [1, 2, 1, 3]);
  await open(page, 1440);
  const rows = page.locator('.timeline > .song');
  await rows.nth(2).locator('.song-select').click();
  await expect(rows.nth(2).locator('.song-select')).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(0).locator('.song-select')).not.toHaveAttribute('aria-current', 'true');
  const key = await rows.nth(2).getAttribute('data-song-key');
  await rows.nth(2).getByRole('button', { name: /Move Morning Light up/ }).click();
  await expect.poll(() => order(page)).toEqual(['Morning Light', 'Morning Light', 'Slow Tide', 'Paper Moon']);
  // the selection followed the moved occurrence, now second, and not the first copy
  const selected = page.locator('.timeline > .song .song-select[aria-current="true"]');
  await expect(selected).toHaveCount(1);
  await expect(page.locator(`.timeline > .song[data-song-key="${key}"] .song-select`)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator(`.timeline > .song[data-song-key="${key}"]`)).toHaveAttribute('data-position', '1');
  await expect(page.locator(`.timeline > .song[data-song-key="${key}"] .grip`)).toHaveAttribute('aria-description', 'Song occurrence 2 of 4');
});

test('MP-0287-06 add-a-song targets are visible and quiet between songs', async ({ page, request }) => {
  await resetMix(request);
  for (const width of WIDTHS) {
    await open(page, width);
    const gaps = await page.locator('.timeline .add-gap button').evaluateAll((buttons) => buttons.map((button) => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return { height: box.height, width: box.width, background: style.backgroundColor, border: style.borderTopColor, colour: style.color, opacity: Number(style.opacity), right: box.right };
    }));
    if (!gaps.length) continue;
    for (const gap of gaps) {
      expect(gap.height, `${width}px: add target height`).toBeGreaterThanOrEqual(24);
      expect(gap.opacity, `${width}px: add target visible`).toBe(1);
      expect(gap.background, `${width}px: add target is not a filled button`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(gap.right).toBeLessThanOrEqual(width);
    }
    await expect(page.locator('.timeline .add-gap button').first()).toHaveAccessibleName(/Add a song after/);
  }
});

test('MP-0287-07 current or draft and Story, Arrange or Detail stay named in the pinned bar while scrolling', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const width of [320, 1440]) {
    await open(page, width, 700);
    const bar = page.locator('.editor-scope');
    await expect(bar.locator('.scope-badge')).toHaveText('Editing the current mix');
    await expect(bar.locator('.scope-view')).toHaveText('Arrange view');
    const top = (await bar.boundingBox())!.y;
    await page.mouse.wheel(0, 2000);
    await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThan(top + 1);
    const pinned = (await bar.boundingBox())!;
    const header = await page.evaluate(() => document.querySelector('header.bar, .bar')?.getBoundingClientRect().bottom ?? 0);
    expect(pinned.y, `${width}px: pinned under the bar`).toBeGreaterThanOrEqual(header - 2);
    expect(pinned.y, `${width}px: still on screen`).toBeLessThan(200);
    await expect(bar.locator('.scope-view')).toBeInViewport();
    await expect(bar.locator('.scope-badge')).toBeInViewport();
  }
  await page.goto('/mix/current/edit?view=story');
  await page.getByRole('radio', { name: 'Story' }).check();
  await expect(page.locator('.editor-scope .scope-view')).toHaveText('Story view');
});

test('MP-0287-08 a 100-song mix opens quickly, keeps focus on a moved song and never touches the music', async ({ page, request }) => {
  test.setTimeout(300_000);
  await spyOnAudio(page);
  await request.post('/api/mix/clear');
  for (let index = 0; index < 100; index += 1) await request.post('/api/mix/songs', { data: { song_id: (index % 12) + 1 } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(async () => (await audioClock(page))[0] ?? 0).toBeGreaterThan(0.2);
  const started = await soundsRestarted(page);
  const began = Date.now();
  await page.evaluate(() => { window.history.pushState({}, '', '/mix/current/edit'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.timeline > .song')).toHaveCount(100);
  const opened = Date.now() - began;
  expect(opened, 'opening 100 songs').toBeLessThan(5000);
  await expect(page.locator('.timeline')).toHaveClass(/long/);
  const row = page.locator('.timeline > .song').nth(50);
  await row.scrollIntoViewIfNeeded();
  const grip = row.locator('.grip');
  const name = await grip.getAttribute('aria-label');
  await grip.focus();
  const moved = Date.now();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.timeline > .song').nth(49).locator('.grip')).toBeFocused();
  await expect(page.locator('.timeline > .song').nth(49).locator('.grip')).toHaveAttribute('aria-label', name!);
  expect(Date.now() - moved, 'a move in a long mix').toBeLessThan(3000);
  // moving a song far from the playing one restarts nothing and the clock keeps running
  const clock = (await audioClock(page))[0];
  await expect.poll(async () => (await audioClock(page))[0]).toBeGreaterThan(clock + 0.3);
  expect(await soundsRestarted(page), 'no sound restarted').toBe(started);
});
