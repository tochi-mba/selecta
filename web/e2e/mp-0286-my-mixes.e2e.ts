import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { audioClock, resetMix, soundsRestarted, spyOnAudio } from './helpers';

/**
 * ADR-0286 My Mixes: current and draft cards, metadata, inline rename, draft actions, the render line,
 * polling and scoped feedback. Edge, muted, the real stylesheet and tests/e2e_server.py. Candidates for an
 * independent reviewer, not a human approval.
 */
const WIDTHS = [320, 768, 1440] as const;
type Made = { id: number; name: string };

async function draft(request: APIRequestContext, name: string, songs: number[]): Promise<Made> {
  const made = await (await request.post('/api/drafts', { data: { name } })).json();
  for (const song of songs) await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: song } });
  return { id: made.id, name: made.name };
}

async function clearDrafts(request: APIRequestContext) {
  const list = await (await request.get('/api/drafts')).json();
  for (const item of list.drafts as Made[]) await request.delete(`/api/drafts/${item.id}`);
}

async function mine(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/mixes/mine');
  await expect(page.locator('.draft-list .draft').first()).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

const ids = async (request: APIRequestContext, draftId?: number) => ((await (await request.get(draftId ? `/api/mix?draft=${draftId}` : '/api/mix')).json()).mix as { song_id: number }[]).map((item) => item.song_id);

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
  await clearDrafts(request);
});

test('MP-0286-01 while the current mix plays, no draft looks or reads as playing', async ({ page, request }) => {
  await spyOnAudio(page);
  await draft(request, 'Sunday slow', [5, 6]);
  await draft(request, 'Late run', [7, 8, 9]);
  await page.goto('/listen');
  await page.locator('.now .transport .primary').click();
  await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
  await page.evaluate(() => { window.history.pushState({}, '', '/mixes/mine'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.draft-list .draft').first()).toBeVisible();
  const current = page.locator('.carry-on');
  await expect(current.locator('.eyebrow')).toHaveText('Playing now');
  const marker = await current.evaluate((element) => getComputedStyle(element).boxShadow);
  const drafts = await page.locator('.draft-list .draft').evaluateAll((items) => items.map((item) => ({ text: item.textContent ?? '', shadow: getComputedStyle(item).boxShadow, classes: item.className })));
  for (const item of drafts) {
    expect(item.text, 'a draft claims to be playing').not.toMatch(/Playing now|Now playing|Paused/);
    expect(item.classes).not.toContain('playing');
    expect(item.shadow, 'a draft wears the playing marker').not.toBe(marker);
  }
  await expect(page.getByRole('button', { name: 'Play Sunday slow' })).toHaveAttribute('title', /What was playing is kept in your drafts/);
});

test('MP-0286-02 name, songs and length, and readiness keep one edge and steady lines on every card', async ({ page, request }) => {
  await draft(request, 'A', [1, 2]);
  await draft(request, 'A rather longer draft name that may need to wrap on a phone', [3, 4, 5, 6]);
  await draft(request, 'Empty one', []);
  for (const width of WIDTHS) {
    await mine(page, width);
    const cards = await page.locator('.draft-list .draft').evaluateAll((items) => items.map((item) => {
      const at = (selector: string) => item.querySelector(selector)?.getBoundingClientRect() ?? null;
      const name = at('.draft-open')!;
      const facts = at('.draft-name > .soft')!;
      const status = at('.draft-name > .status')!;
      return { name: name.left, nameBottom: name.bottom, facts: facts.left, factsTop: facts.top, factsBottom: facts.bottom, status: status.left, statusTop: status.top, actions: at('.draft-actions')!.right, right: item.getBoundingClientRect().right };
    }));
    expect(cards.length).toBe(3);
    for (const card of cards) {
      const where = `${width}px`;
      expect(Math.abs(card.facts - card.name), `${where}: facts edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(card.status - card.name), `${where}: status edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(card.name - cards[0].name), `${where}: names share a column`).toBeLessThanOrEqual(1);
      expect(card.factsTop, `${where}: facts under the name`).toBeGreaterThanOrEqual(card.nameBottom - 1);
      expect(card.statusTop, `${where}: readiness under the facts`).toBeGreaterThanOrEqual(card.factsBottom - 1);
      expect(card.actions, `${where}: actions inside`).toBeLessThanOrEqual(card.right);
      if (width >= 768) expect(Math.abs(card.actions - cards[0].actions), `${where}: actions share an edge`).toBeLessThanOrEqual(1);
    }
  }
});

test('MP-0286-03 renaming keeps the card in place, starts in the field and gives focus back', async ({ page, request }) => {
  const made = await draft(request, 'Rename me', [1, 2]);
  for (const width of [320, 1440]) {
    await mine(page, width);
    const card = page.locator('.draft-list .draft').first();
    // on a phone the card starts below the fold; bring its menu into view first, so pressing it scrolls
    // nothing and any movement measured is the rename's own
    const more = card.getByRole('button', { name: `More actions for ${made.name}` });
    await more.scrollIntoViewIfNeeded();
    const before = (await card.boundingBox())!;
    await more.click();
    await page.getByRole('menuitem', { name: `Rename ${made.name}` }).click();
    const field = card.getByRole('textbox', { name: 'Name this draft' });
    await expect(field).toBeFocused();
    const during = (await card.boundingBox())!;
    expect(Math.abs(during.width - before.width), `${width}px: width`).toBeLessThanOrEqual(1);
    expect(Math.abs(during.x - before.x), `${width}px: left`).toBeLessThanOrEqual(1);
    expect(Math.abs(during.y - before.y), `${width}px: top`).toBeLessThanOrEqual(1);
    expect(during.height - before.height, `${width}px: grows by at most one control row`).toBeLessThanOrEqual(width < 600 ? 110 : 56);
    await page.keyboard.press('Escape');
    await expect(page.locator(`#draft-${made.id}`)).toBeFocused();
    const after = (await card.boundingBox())!;
    expect(Math.abs(after.height - before.height), `${width}px: back to its size`).toBeLessThanOrEqual(1);
  }
});

test('MP-0286-04 Edit leads, Play explains itself, and Copy, Prioritize and Delete wait in the menu', async ({ page, request }) => {
  const made = await draft(request, 'Tiered', [1, 2, 3]);
  await mine(page);
  const card = page.locator('.draft-list .draft').first();
  const look = await card.locator('.draft-actions').evaluate((row) => [...row.querySelectorAll(':scope > button, :scope > .menu > button')].map((button) => ({ text: (button.querySelector('.action-labels > :first-child') ?? button).textContent?.trim(), primary: button.classList.contains('primary'), background: getComputedStyle(button).backgroundColor })));
  expect(look[0], 'Edit first and primary').toMatchObject({ text: 'Edit', primary: true });
  expect(look[1].text).toBe('Play');
  expect(look[1].primary).toBe(false);
  expect(look[1].background).not.toBe(look[0].background);
  await expect(card.getByRole('button', { name: `Play ${made.name}` })).toHaveAttribute('title', /Plays this now/);
  await card.getByRole('button', { name: `More actions for ${made.name}` }).click();
  const items = await page.getByRole('menuitem').allTextContents();
  expect(items.map((item) => item.trim())).toEqual(expect.arrayContaining(['Rename', 'Copy', 'Delete']));
  expect(items.at(-1)!.trim(), 'Delete comes last').toBe('Delete');
  await page.getByRole('menuitem', { name: `Delete ${made.name}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Your current mix and original music files are untouched');
  await expect(dialog.getByRole('button', { name: 'Keep draft' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete draft' })).toHaveClass(/destructive/);
  await dialog.getByRole('button', { name: 'Keep draft' }).click();
  await expect(page.locator('.draft-list .draft')).toHaveCount(1);
});

/** A render line with every state in it, served in place of the real list (the server only has one CPU's worth of rendering). */
function lineList(names: string[], extra: { out_of_room?: boolean } = {}) {
  const drafts = names.map((name, index) => ({
    id: 900 + index, name, songs: 6, seconds: 1200, seams: 5, ready: index === 1 ? 2 : 0, failed: index === 2 ? 1 : 0,
    waiting: index === 2 ? 4 : 5 - (index === 1 ? 2 : 0), rendering: index === 0, place: index + 1,
    eta: { seconds: 120, low: 60, high: 180 }, to_render: 120, missing: 0,
  }));
  return { drafts, current: { name: 'Your mix', songs: 4, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: extra.out_of_room ?? false };
}

test('MP-0286-05 the render line: place, name and moves line up, and paused and failed say so', async ({ page }) => {
  const names = ['First in line', 'A second draft with a far longer name than the others', 'Third, with a failure', '4', '5', '6', '7', '8', '9', 'Tenth'];
  await page.route('**/api/drafts', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: lineList(names, { out_of_room: true }) }) : route.fallback()));
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/mixes/mine');
    const line = page.getByRole('region', { name: 'Render line' });
    await expect(line.locator('.line-controls')).toHaveCount(10);
    const rows = await line.locator('.line-controls').evaluateAll((items) => items.map((item) => ({
      place: item.querySelector('.line-place')!.getBoundingClientRect(),
      name: item.querySelector('.line-name')!.getBoundingClientRect(),
      buttons: item.querySelector('.line-buttons')!.getBoundingClientRect(),
      right: item.getBoundingClientRect().right,
    })));
    for (const row of rows) {
      const where = `${width}px`;
      expect(Math.abs(row.place.left - rows[0].place.left), `${where}: place column`).toBeLessThanOrEqual(1);
      if (width >= 768) {
        expect(Math.abs(row.name.left - rows[0].name.left), `${where}: names share a column, 1st to 10th`).toBeLessThanOrEqual(1);
        expect(Math.abs(row.buttons.right - rows[0].buttons.right), `${where}: moves share an edge`).toBeLessThanOrEqual(1);
      }
      expect(row.buttons.right, `${where}: buttons inside`).toBeLessThanOrEqual(row.right);
    }
    await expect(page.getByText('Rendering has paused: your stems have reached their storage limit.')).toBeVisible();
    const failed = page.locator('.draft-list .draft', { hasText: 'Third, with a failure' });
    await expect(failed.locator('.status')).toContainText(/couldn’t|failed|Fix|Change/i);
  }
});

test('MP-0286-06 status checks change words and bars, never the order, the focus or the cards’ places', async ({ page }) => {
  const names = ['North', 'South', 'East'];
  let tick = 0;
  await page.route('**/api/drafts', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    tick += 1;
    const list = lineList(names);
    for (const item of list.drafts) {
      item.ready = Math.min(5, tick % 6);
      item.waiting = 5 - item.ready;
      item.rendering = item.ready < 5;
    }
    return route.fulfill({ json: list });
  });
  await page.clock.install();
  await mine(page);
  const play = page.getByRole('button', { name: 'Play South' });
  await play.focus();
  const where = () => page.locator('.draft-list .draft').evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return { name: item.querySelector('.draft-open')!.textContent, top: Math.round(box.top), height: Math.round(box.height) };
  }));
  const before = await where();
  for (let check = 0; check < 5; check += 1) {
    const seen = tick;
    await page.clock.runFor(4100);
    await expect.poll(() => tick).toBeGreaterThan(seen);
    const now = await where();
    expect(now.map((item) => item.name), 'order').toEqual(before.map((item) => item.name));
    for (let index = 0; index < now.length; index += 1) {
      expect(Math.abs(now[index].top - before[index].top), 'card jolted').toBeLessThanOrEqual(1);
      expect(Math.abs(now[index].height - before[index].height), 'card resized').toBeLessThanOrEqual(1);
    }
    await expect(play).toBeFocused();
  }
});

test('MP-0286-07 Copy, Delete, Undo and Play each touch exactly the draft or current mix they name', async ({ page, request }) => {
  await spyOnAudio(page);
  const one = await draft(request, 'Twin', [5, 6]);
  const two = await draft(request, 'Twin', [7, 8]);
  await mine(page);
  // Copy the second Twin: a new draft with its songs, nothing else changes
  await page.locator('.draft-list .draft', { has: page.locator(`#draft-${two.id}`) }).getByRole('button', { name: /More actions/ }).click();
  // the server keeps draft names apart (the second Twin is given its own), so use the name it gave
  await page.getByRole('menuitem', { name: `Copy ${two.name}`, exact: true }).click();
  await expect(page.locator('.draft-list .draft')).toHaveCount(3);
  const list = (await (await request.get('/api/drafts')).json()).drafts as Made[];
  const copy = list.find((item) => item.id !== one.id && item.id !== two.id)!;
  expect(await ids(request, copy.id), 'copy has the second twin’s songs').toEqual([7, 8]);
  expect(await ids(request, one.id)).toEqual([5, 6]);
  // Delete the first Twin, then Undo: that one comes back, the copy and second twin untouched
  await page.locator('.draft-list .draft', { has: page.locator(`#draft-${one.id}`) }).getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: `Delete ${one.name}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete draft' }).click();
  await expect(page.locator('.draft-list .draft')).toHaveCount(2);
  await page.getByRole('button', { name: /Undo|Bring it back/ }).first().click();
  await expect(page.locator('.draft-list .draft')).toHaveCount(3);
  const back = ((await (await request.get('/api/drafts')).json()).drafts as Made[]).map((item) => item.id).sort();
  expect(back).toEqual([one.id, two.id, copy.id].sort());
  expect(await ids(request, one.id)).toEqual([5, 6]);
  expect(await ids(request)).toEqual([1, 2, 3, 4]);
  // Play the second Twin: it becomes current, and what was current is kept as a draft
  const started = await soundsRestarted(page);
  await page.locator('.draft-list .draft', { has: page.locator(`#draft-${two.id}`) }).getByRole('button', { name: /^Play / }).click();
  await expect.poll(() => ids(request)).toEqual([7, 8]);
  await expect.poll(async () => (await soundsRestarted(page)) > started).toBe(true);
  const kept = (await (await request.get('/api/drafts')).json()).drafts as Made[];
  const keptIds = await Promise.all(kept.map((item) => ids(request, item.id)));
  expect(keptIds, 'the old current mix was kept').toContainEqual([1, 2, 3, 4]);
  expect(keptIds, 'the first twin untouched').toContainEqual([5, 6]);
  await expect.poll(async () => (await audioClock(page))[0] ?? 0).toBeGreaterThan(0);
});
