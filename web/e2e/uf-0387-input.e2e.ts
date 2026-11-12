import { writeFileSync } from 'node:fs';
import { APIRequestContext, expect, test, type Locator, type Page } from '@playwright/test';
import { PAGES, resetMix } from './helpers';

/**
 * The code half of UF-0387-04, -06, -08 and UF-0380-08, against tests/e2e_server.py and Lucy's
 * built-in planner. Lab candidates only: a real phone keyboard, a 3840px visual review and a
 * cross-device journey are still a person's (docs/verification/uf/platform-report.json).
 */

type Keyboard = { keyboardTo: (height: number) => void };

/** A phone's visual viewport, shorter by whatever the on-screen keyboard covers (as MI-0141 does). */
async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    let keyboard = 0;
    const events = new EventTarget();
    const view = {
      get width() { return window.innerWidth; },
      get height() { return Math.max(window.innerHeight - keyboard, 0); },
      offsetTop: 0, offsetLeft: 0, scale: 1, onresize: null, onscroll: null,
      get pageTop() { return window.scrollY; },
      get pageLeft() { return window.scrollX; },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => view });
    window.addEventListener('scroll', () => events.dispatchEvent(new Event('scroll')));
    (window as unknown as Keyboard).keyboardTo = (height: number) => {
      keyboard = height;
      events.dispatchEvent(new Event('resize'));
    };
  });
}

async function conversationWithProposal(request: APIRequestContext): Promise<string> {
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'UF e2e' } })).json();
  const sent = await request.post(`/api/lucy/conversations/${made.id}/turns`, {
    data: { client_id: `uf-${Date.now()}`, text: 'make me 6 songs', expected_revision: null },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => {
    const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
    return snap.messages.filter((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete').length;
  }, { timeout: 60_000 }).toBe(1);
  return made.id;
}

/** On screen above the keyboard, with nothing fixed drawn over its middle. */
const clearOfKeyboard = (target: Locator, name: string) => target.evaluate((node, label) => {
  node.scrollIntoView({ block: 'nearest' });
  const box = node.getBoundingClientRect();
  const bottom = window.visualViewport!.height;
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (box.height === 0) return `${label}: not drawn`;
  if (box.top < -0.5 || box.bottom > bottom + 0.5) return `${label}: ${Math.round(box.top)} to ${Math.round(box.bottom)}, keyboard starts at ${Math.round(bottom)}`;
  if (!hit || !(hit === node || node.contains(hit))) return `${label}: covered by ${hit?.tagName.toLowerCase()}.${hit ? [...hit.classList].join('.') : ''}`;
  return '';
}, name);

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

test('UF-0387-04 with the on-screen keyboard open, the Lucy prompt, Send and approval actions stay clear of it', async ({ page, request }) => {
  const id = await conversationWithProposal(request);
  await fakeKeyboard(page);
  for (const [width, height, keyboard] of [[375, 812, 336], [390, 844, 346], [360, 640, 290]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/mixes/lucy/${id}`);
    const prompt = page.getByRole('textbox', { name: 'Message to Lucy' });
    await expect(prompt).toBeVisible();
    await prompt.focus();
    await page.evaluate((h) => (window as unknown as Keyboard).keyboardTo(h), keyboard);
    await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
    const at = `${width}x${height} with a ${keyboard}px keyboard`;
    expect(await clearOfKeyboard(prompt, 'prompt'), at).toBe('');
    await prompt.fill('Keep it calm');
    const send = page.getByRole('button', { name: 'Send' });
    expect(await send.evaluate((node) => !!node.closest('.lucy-composer-row')), `${at}: Send (and Stop) live in the composer row`).toBe(true);
    expect(await clearOfKeyboard(send, 'Send'), at).toBe('');
    // the approval actions, reached while the keyboard is still up
    await page.getByRole('tab', { name: 'Your mix' }).click();
    for (const name of ['Save as draft', 'Save and play']) {
      const button = page.getByRole('button', { name });
      await button.scrollIntoViewIfNeeded();
      const problem = await button.evaluate((node, label) => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (box.bottom > window.visualViewport!.height + 0.5) return `${label}: under the keyboard`;
        return hit && (hit === node || node.contains(hit)) ? '' : `${label}: covered`;
      }, name);
      expect(problem, at).toBe('');
    }
    await page.evaluate(() => (window as unknown as Keyboard).keyboardTo(0));
  }
});

test('UF-0387-06 at 3840px, reading text keeps a bounded measure instead of stretching across the screen', async ({ page }, info) => {
  test.setTimeout(5 * 60_000);
  await page.setViewportSize({ width: 3840, height: 2160 });
  const readings = [];
  for (const route of PAGES) {
    await page.goto(route);
    await expect(page.locator('main#main')).toBeVisible();
    const reading = await page.evaluate(() => {
      const main = document.querySelector('main#main')!.getBoundingClientRect();
      const long = [...document.querySelectorAll<HTMLElement>('main p, main li > span, main dd')]
        .filter((node) => (node.textContent ?? '').trim().length > 80 && node.getBoundingClientRect().width > 0)
        .map((node) => {
          const em = parseFloat(getComputedStyle(node).fontSize) || 16;
          return { text: (node.textContent ?? '').trim().slice(0, 40), ems: Math.round(node.getBoundingClientRect().width / em) };
        });
      return { mainWidth: Math.round(main.width), widest: long.sort((a, b) => b.ems - a.ems).slice(0, 3) };
    });
    // about 80 characters of body text is near 45em; anything past 60em is a stretched paragraph
    for (const line of reading.widest) expect(line.ems, `${route}: "${line.text}" runs ${line.ems}em wide`).toBeLessThanOrEqual(60);
    readings.push({ route, ...reading });
  }
  writeFileSync(info.outputPath('uf-0387-06-wide.json'), JSON.stringify({ status: 'candidate-not-independently-verified', width: 3840, readings }, null, 2));
});

/** Every action name in main, shown or folded away, so a phone layout cannot quietly drop one. */
const actions = (page: Page) => page.evaluate(() => [...new Set([...document.querySelectorAll<HTMLElement>('main button, main a[href], main [role="tab"], main [role="menuitem"]')]
  .map((node) => (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim())
  .filter((name) => name && !/^\d+(:\d+)?$/.test(name)))].sort());

test('UF-0387-08 desktop and phone offer the same actions and the same music on every page', async ({ page }, info) => {
  test.setTimeout(5 * 60_000);
  const report = [];
  for (const route of PAGES) {
    const seen: Record<string, string[]> = {};
    const music: Record<string, unknown> = {};
    for (const [label, width, height] of [['desktop', 1280, 800], ['phone', 375, 812]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(route);
      await expect(page.locator('main#main')).toBeVisible();
      await page.waitForLoadState('networkidle');
      seen[label] = await actions(page);
      music[label] = await page.evaluate(() => [...document.querySelectorAll('main .song-name, main .library-count, main .timeline > .song')].map((node) => node.textContent?.trim()));
    }
    const missing = seen.desktop.filter((name) => !seen.phone.includes(name));
    expect(missing, `${route}: actions on desktop that the phone layout lacks`).toEqual([]);
    expect(music.phone, `${route}: the phone shows different music`).toEqual(music.desktop);
    report.push({ route, desktop: seen.desktop.length, phone: seen.phone.length, extraOnPhone: seen.phone.filter((name) => !seen.desktop.includes(name)) });
  }
  writeFileSync(info.outputPath('uf-0387-08-parity.json'), JSON.stringify({ status: 'candidate-not-independently-verified', report }, null, 2));
});

test('UF-0380-08 a 45-song mix opens quickly and stays navigable by keyboard at phone, tablet and desktop widths', async ({ page, request }) => {
  test.setTimeout(5 * 60_000);
  await request.post('/api/mix/clear');
  for (let index = 0; index < 45; index += 1) await request.post('/api/mix/songs', { data: { song_id: (index % 12) + 1 } });
  for (const [width, height] of [[375, 812], [768, 1024], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    const began = Date.now();
    await page.goto('/mix/current/edit');
    await expect(page.locator('.timeline > .song')).toHaveCount(45);
    expect(Date.now() - began, `${width}px: opening 45 songs`).toBeLessThan(5000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px: scrolls sideways`).toBeLessThanOrEqual(width);
    const row = page.locator('.timeline > .song').nth(30);
    await row.scrollIntoViewIfNeeded();
    const grip = row.locator('.grip');
    const name = await grip.getAttribute('aria-label');
    await grip.focus();
    const moved = Date.now();
    await page.keyboard.press('ArrowUp');
    const above = page.locator('.timeline > .song').nth(29).locator('.grip');
    await expect(above).toBeFocused();
    await expect(above).toHaveAttribute('aria-label', name!);
    expect(Date.now() - moved, `${width}px: a move in a 45-song mix`).toBeLessThan(3000);
    // the moved song is on screen, not scrolled away
    const box = (await above.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.timeline > .song').nth(30).locator('.grip')).toBeFocused();
  }
});
