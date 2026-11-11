/* LX-0364-07: long, right-to-left and CJK titles stay readable at 400% zoom (a 1280px window at
 * 400% is 320 CSS px) in Lucy's proposal and the Library, with numbers in even columns and every
 * song's controls reachable by keyboard. The made-up library from tests/e2e_server.py carries a
 * Hebrew, an Arabic, a Japanese and a very long title; Lucy's built-in planner makes the proposal,
 * so no AI service is ever called. */
import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { resetMix, stickingOut } from './helpers';

const RTL = /[֐-ۿ]/;
const CJK = /[぀-ヿ一-鿿]/;

test.beforeEach(async ({ request }) => {
  await resetMix(request);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

async function proposalOfEverything(request: APIRequestContext): Promise<string> {
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'LX intl' } })).json();
  const sent = await request.post(`/api/lucy/conversations/${made.id}/turns`, {
    data: { client_id: `lx-intl-${Date.now()}`, text: 'make me 12 songs', expected_revision: null },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => {
    const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
    return snap.messages.filter((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete').length;
  }, { timeout: 60_000 }).toBe(1);
  return made.id;
}

/** Each title as drawn: its text, the direction the browser chose, and whether it fits the row. */
const titles = (page: Page, selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
  const rect = node.getBoundingClientRect();
  const row = (node.closest('li, [role="row"], tr, article') ?? node.parentElement)!.getBoundingClientRect();
  return {
    text: node.textContent ?? '',
    dir: node.getAttribute('dir'),
    direction: getComputedStyle(node).direction,
    fits: rect.left >= row.left - 1 && rect.right <= row.right + 1 && rect.right <= window.innerWidth + 1,
    height: rect.height,
  };
}));

test('LX-0364-07 long, RTL and CJK titles stay readable at 400% zoom in Lucy and the Library', async ({ page, request }) => {
  const id = await proposalOfEverything(request);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/mixes/lucy/${id}`);
  await page.getByRole('tab', { name: 'Your mix' }).click();
  await expect(page.locator('.lucy-song').first()).toBeVisible();

  const drawn = await titles(page, '.lucy-song-name b');
  expect(drawn.length).toBeGreaterThanOrEqual(6);
  const rtl = drawn.filter((title) => RTL.test(title.text));
  const cjk = drawn.filter((title) => CJK.test(title.text));
  const long = drawn.filter((title) => title.text.length > 60);
  expect(rtl.length + cjk.length + long.length, 'the proposal holds international titles').toBeGreaterThan(0);
  for (const title of drawn) {
    expect(title.dir, title.text).toBe('auto');
    expect(title.fits, `${title.text} fits its row at 320px`).toBe(true);
    expect(title.height, `${title.text} is drawn`).toBeGreaterThan(0);
  }
  for (const title of rtl) expect(title.direction, title.text).toBe('rtl');
  for (const title of [...cjk, ...long]) expect(title.direction, title.text).toBe('ltr');
  // times, tempos and keys line up in even columns
  const numbers = await page.locator('.lucy-song-facts').first().evaluate((node) => getComputedStyle(node).fontVariantNumeric);
  expect(numbers).toContain('tabular-nums');
  expect(await stickingOut(page, 'Lucy proposal at 320px')).toEqual([]);

  // every song's controls are reachable from the keyboard, the international ones included
  const target = (rtl[0] ?? cjk[0] ?? long[0]).text;
  const ask = page.getByRole('button', { name: `Ask about ${target}`, exact: true }).first();
  await page.getByRole('tab', { name: 'Your mix' }).focus();
  let reached = false;
  for (let presses = 0; presses < 200 && !reached; presses += 1) {
    await page.keyboard.press('Tab');
    reached = await ask.evaluate((node) => node === document.activeElement);
  }
  expect(reached, `Tab reaches Ask about ${target}`).toBe(true);
  await expect(ask).toBeInViewport();

  // the same titles in the Library, at the same zoom
  for (const query of ['שלום', '日本語', 'Extended']) {
    await page.goto(`/library?q=${encodeURIComponent(query)}`);
    const row = page.locator('main b[dir="auto"]').filter({ hasText: query }).first();
    await expect(row).toBeVisible();
    const seen = await titles(page, 'main b[dir="auto"]');
    const match = seen.find((title) => title.text.includes(query))!;
    expect(match.fits, `${query} fits the Library row at 320px`).toBe(true);
    expect(match.direction).toBe(RTL.test(query) ? 'rtl' : 'ltr');
    expect(await stickingOut(page, `Library "${query}" at 320px`)).toEqual([]);
  }
});
