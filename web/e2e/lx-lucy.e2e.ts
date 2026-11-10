/* LX-0353 to LX-0364: Make a Mix's two ways in and Lucy's workspace in a real browser, against the
 * made-up library from tests/e2e_server.py and Lucy's built-in planner (no AI service is ever
 * called). Playback is real and muted. Each test names the checklist items it proves; the
 * component-level twins are src/views/LucyLx.test.tsx and src/views/LucyLxPage.test.tsx. */
import { APIRequestContext, expect, Locator, Page, test } from '@playwright/test';
import { audioClock, resetMix, soundsStarted, spyOnAudio, stickingOut } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMix(request);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

type Rect = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Rect> => (await locator.boundingBox())!;
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Nothing lies on top of the control's centre. */
const reachable = (control: Locator) => control.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return !!hit && (hit === node || node.contains(hit));
});

/** A conversation with a proposal in it, made through the API with the built-in planner. */
async function conversationWithProposal(request: APIRequestContext, turns = ['make me 6 songs']): Promise<string> {
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'LX e2e' } })).json();
  for (const [index, text] of turns.entries()) {
    const sent = await request.post(`/api/lucy/conversations/${made.id}/turns`, {
      data: { client_id: `lx-${Date.now()}-${index}`, text, expected_revision: null },
    });
    expect(sent.ok()).toBe(true);
    await expect.poll(async () => {
      const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
      return snap.messages.filter((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete').length;
    }, { timeout: 60_000 }).toBe(index + 1);
  }
  return made.id;
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message to Lucy' });

test('LX-0353-01, -03 and -07 Make a Mix offers Quick Play and Lucy as two choices above the feelings, with no floating Lucy', async ({ page }) => {
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/mixes');
    const quick = page.locator('section.mix-quick');
    const create = page.locator('section.mix-create');
    await expect(quick.getByRole('heading', { name: 'Listen now, shape later' })).toBeVisible();
    await expect(create.getByRole('heading', { name: 'Create with Lucy' })).toBeVisible();
    await expect(create.getByText('Quick Play does not use Lucy.')).toBeVisible();
    const feelings = await box(page.getByRole('heading', { name: 'Choose another feeling' }));
    for (const choice of [quick, create]) {
      const rect = await box(choice);
      expect(rect.y + rect.height).toBeLessThanOrEqual(feelings.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 0.5);
    }
    expect(await stickingOut(page, `/mixes at ${width}px`)).toEqual([]);
    const plan = create.getByRole('link', { name: 'Plan a mix with Lucy' });
    expect((await box(plan)).height).toBeGreaterThanOrEqual(24);
  }
  // Lucy lives in Make a Mix only: no floating bot button over any other page.
  for (const address of ['/listen', '/library', '/mixes/mine']) {
    await page.goto(address);
    await expect(page.locator('main')).toBeVisible();
    const floating = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((node) => ['fixed', 'sticky'].includes(getComputedStyle(node).position) && /lucy/i.test(`${node.className} ${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`) && !node.matches('header, nav, .shell-header, .nav, .rail'))
      .map((node) => node.className));
    expect(floating, address).toEqual([]);
  }
});

test('LX-0353-04 and LX-0354-05 a feeling opens Lucy with editable words; nothing is sent, saved or played', async ({ page, request }) => {
  await spyOnAudio(page);
  const before = (await (await request.get('/api/lucy/conversations?archived=0')).json()).conversations.length;
  const mixBefore = (await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id);
  await page.goto('/mixes');
  const card = page.locator('article.vibe-card').first();
  const name = (await card.locator('h3').first().textContent())!.trim();
  await card.locator('summary').click();
  await card.getByRole('link', { name: 'Use this feeling with Lucy' }).click();
  await expect(page).toHaveURL(/\/mixes\/lucy(\?|$)/);
  await expect(composer(page)).toHaveValue(new RegExp(`the ${name} feeling`));
  await expect(page).not.toHaveURL(/prompt=/);
  // the words can be edited before anything is sent
  await composer(page).press('End');
  await composer(page).type(' Keep it short.');
  await expect(composer(page)).toHaveValue(/Keep it short\.$/);
  await page.waitForTimeout(1500);
  expect((await (await request.get('/api/lucy/conversations?archived=0')).json()).conversations.length).toBe(before);
  expect((await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id)).toEqual(mixBefore);
  expect(await soundsStarted(page)).toBe(0);
});

test('LX-0353-02, -06 and LX-0363-07 Quick Play works with Lucy off, and moving between pages never restarts the music', async ({ page, request }) => {
  await spyOnAudio(page);
  await request.put('/api/lucy/settings', { data: { enabled: false } });
  try {
    await page.goto('/mixes');
    await page.locator('section.mix-quick').getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('.mini, .now .transport').getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => soundsStarted(page), { timeout: 30_000 }).toBeGreaterThan(0);
    const contexts = (await audioClock(page)).length;
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Make a Mix', exact: true }).click();
    await page.getByRole('link', { name: 'Plan a mix with Lucy' }).click();
    await expect(page.getByRole('heading', { name: 'Lucy is turned off' })).toBeVisible();
    await page.locator('.lucy-gate').getByRole('link', { name: 'Go to Make a Mix' }).click();
    await expect(page).toHaveURL(/\/mixes$/);
    // the replacement safeguard is still there: Play asks first while something plays
    await page.locator('section.mix-quick').getByRole('button', { name: 'Play', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^Replace / });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.goBack();
    await expect(page).toHaveURL(/\/mixes\/lucy$/);
    await nav.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page).toHaveURL(/\/library$/);
    const clock = (await audioClock(page))[0];
    await page.waitForTimeout(1200);
    expect((await audioClock(page))[0]).toBeGreaterThan(clock);
    expect((await audioClock(page)).length).toBe(contexts);
    await expect(page.locator('.mini').getByRole('button', { name: 'Pause' })).toBeVisible();
  } finally {
    await request.put('/api/lucy/settings', { data: { enabled: true } });
  }
});

test('LX-0355-01, -03, -05 and LX-0356-01 panes split only when both stay readable; history never squeezes them', async ({ page, request }) => {
  const id = await conversationWithProposal(request);
  const widths = async () => page.evaluate(() => {
    const width = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    return { chat: width('.lucy-chat'), side: width('.lucy-side'), history: width('.lucy-history-col') };
  });
  // the conversation list gets its own column only when the page itself is at least 1280px wide
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto(`/mixes/lucy/${id}`);
  await expect(page.locator('main.lucy')).toHaveClass(/is-split/);
  await expect(page.locator('.lucy-history-col')).toBeVisible();
  let seen = await widths();
  expect(seen.chat).toBeGreaterThanOrEqual(320);
  expect(seen.side).toBeGreaterThanOrEqual(340);
  // the proposal and its revision stay in view however far the chat is scrolled
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.lucy-side').getByRole('button', { name: /Revision 1/ })).toBeInViewport();
  await page.getByRole('button', { name: 'Hide conversations' }).click();
  await expect(page.locator('.lucy-history-col')).toHaveCount(0);
  expect((await widths()).chat).toBeGreaterThan(seen.chat);
  await page.getByRole('button', { name: 'Show conversations' }).click();
  await expect(page.locator('.lucy-history-col')).toBeVisible();
  // a readable measure for Lucy's words: no line wider than about 72 characters
  const measure = await page.locator('.lucy-msg.is-assistant .lucy-text').first().evaluate((node) => {
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(72);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
    node.appendChild(probe);
    const limit = probe.getBoundingClientRect().width;
    probe.remove();
    return { width: node.getBoundingClientRect().width, limit };
  });
  expect(measure.width).toBeLessThanOrEqual(measure.limit + 1);
  // The rule is the page's own width (Lucy.tsx: split from 1100px, a history column from 1280px), so
  // a wide rail or a zoomed page gets the stacked layout rather than two cramped panes.
  for (const width of [1500, 1300, 1100, 900, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const room = await page.locator('main.lucy').evaluate((node) => node.clientWidth);
    const split = room >= 1100;
    await expect(page.locator('main.lucy')).toHaveClass(split ? /is-split/ : /is-stacked/);
    await expect(page.locator('.lucy-history-col')).toHaveCount(room >= 1280 ? 1 : 0);
    seen = await widths();
    if (split) {
      expect(seen.chat, `chat at ${width}px`).toBeGreaterThanOrEqual(320);
      expect(seen.side, `proposal at ${width}px`).toBeGreaterThanOrEqual(340);
    } else {
      await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
    }
    expect(await stickingOut(page, `Lucy at ${width}px`)).toEqual([]);
    if (room < 1280 && width === 1100) {
      // the conversation list opens over the page, can be searched and closed, and never narrows a pane
      await page.getByRole('button', { name: 'Conversations', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: 'Conversations' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('searchbox', { name: 'Search conversations' }).fill('LX e2e');
      await expect(sheet.getByRole('link', { name: /LX e2e/ }).first()).toBeVisible();
      expect(await widths()).toEqual(seen);
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
    }
  }
});

test('LX-0356-05 someone reading back up is not pulled down; a count of new messages appears instead', async ({ page, request }) => {
  const id = await conversationWithProposal(request, ['make me 6 songs', 'how many songs?', 'which transitions are ready?']);
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(`/mixes/lucy/${id}`);
  await expect(page.locator('.lucy-msg')).toHaveCount(6);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const sent = await request.post(`/api/lucy/conversations/${id}/turns`, {
    data: { client_id: `lx-later-${Date.now()}`, text: 'how many songs?', expected_revision: null },
  });
  expect(sent.ok()).toBe(true);
  const fresh = page.getByRole('button', { name: /^New messages \(\d+\)$/ });
  await expect(fresh).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(50);
  await fresh.click();
  await expect.poll(() => page.evaluate(() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 130)).toBe(true);
});

test('LX-0355-07 and LX-0364-05 on a phone the player and nav never cover the composer, and controls are big enough to press', async ({ page, request }) => {
  const id = await conversationWithProposal(request);
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/listen');
  await page.locator('.now .transport .primary').click();
  await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
  // client-side to Lucy, so the music keeps going and the mini-player is on screen
  await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, `/mixes/lucy/${id}`);
  await expect(composer(page)).toBeVisible();
  const chrome = page.locator('.mini, nav.nav');
  const covers = async (target: Locator) => {
    await target.scrollIntoViewIfNeeded();
    const rect = await box(target);
    let worst = 0;
    for (const part of await chrome.all()) if (await part.isVisible()) worst = Math.max(worst, overlap(rect, await box(part)));
    return worst;
  };
  for (const target of [composer(page), page.getByRole('button', { name: 'Send' })]) {
    expect(await covers(target)).toBe(0);
    expect(await reachable(target)).toBe(true);
  }
  await page.getByRole('tab', { name: 'Your mix' }).click();
  for (const target of [page.getByRole('button', { name: 'Save as draft' }), page.getByRole('button', { name: 'Save and play' }), page.locator('.lucy-song [data-act="ask"]').last()]) {
    expect(await covers(target)).toBe(0);
    expect(await reachable(target)).toBe(true);
  }
  // WCAG 2.2 AA target size (24 px) everywhere; the documented exceptions are inline text links
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>('main button, main a, main [role="tab"], main input, main summary')) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || node.closest('[hidden]') || node.matches('.lucy-link, p a, dd a')) continue;
      if (rect.width < 24 || rect.height < 24) out.push(`${node.tagName.toLowerCase()} "${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
  expect(await stickingOut(page, 'Lucy at 375px')).toEqual([]);
});
