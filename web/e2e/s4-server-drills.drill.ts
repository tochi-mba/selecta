import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Selecta 4.0 drills against a real local server (tests/e2e_server.py, made-up library only).
 * Each drill starts its own server, because two of them stop and restart it or need a bigger
 * library. Run with playwright.drills.config.ts. Screenshots go to the Claude-check folder.
 *
 * S4-0103-08 two tabs play the mix while one request is answered: it joins once or not at all.
 * S4-0102-09 a Studio Apply in tab A after tab B moved the pair and switched draft: refused, the
 *            shape stays, and the other draft is untouched.
 * S4-0107-09 the backend stops and restarts mid-session: never shown as zero, and it recovers.
 * S4-0105-07 a library of 200+ pages: readiness on the page being looked at updates in place.
 */
const PYTHON = process.env.SELECTA_PYTHON ?? path.resolve('../.venv/Scripts/python.exe');
const PORT = Number(process.env.SELECTA_E2E_PORT ?? '9741');
const SHOTS = path.resolve('../docs/verification/claude-checks/selecta-4');
mkdirSync(SHOTS, { recursive: true });

type Server = { base: string; stop: () => Promise<void> };

async function ready(base: string, timeout = 300_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server at ${base} never answered`);
}

async function startServer(env: Record<string, string> = {}, port = PORT): Promise<Server> {
  const child: ChildProcess = spawn(PYTHON, ['../tests/e2e_server.py', String(port)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  await ready(base);
  return {
    base,
    stop: () => new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill();
    }),
  };
}

async function api(base: string, method: string, route: string, body?: unknown) {
  const answer = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: answer.status, json: await answer.json().catch(() => null) };
}

async function resetMix(base: string, songs: number[]) {
  await api(base, 'POST', '/api/mix/clear');
  for (const song of songs) await api(base, 'POST', '/api/mix/songs', { song_id: song });
}

const order = (data: { mix: { song_id: number }[] }) => data.mix.map((item) => item.song_id);

async function tab(browser: Browser, base: string): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  return [context, await context.newPage()];
}

async function play(page: Page) {
  await page.goto('/listen');
  const button = page.locator('.now .transport .primary');
  await button.click();
  await expect(button).toHaveText('Pause', { timeout: 60_000 });
}

test('S4-0103-08 two tabs playing, one request: it joins the mix once, and a repeated join is refused', async ({ browser }) => {
  const server = await startServer();
  try {
    await resetMix(server.base, [1, 2, 3, 4]);
    const [contextA, a] = await tab(browser, server.base);
    const [contextB, b] = await tab(browser, server.base);
    const joins: { tab: string; status: number; body: string }[] = [];
    for (const [name, page] of [['A', a], ['B', b]] as const) {
      page.on('response', (response) => {
        if (response.url().endsWith('/api/requests/insert')) joins.push({ tab: name, status: response.status(), body: response.request().postData() ?? '' });
      });
    }
    await play(a);
    await play(b);
    // the request is made in tab A's own drawer, as a person would
    await a.getByRole('button', { name: /^Requests/ }).first().click();
    const drawer = a.getByRole('dialog', { name: 'Requests' });
    await drawer.getByRole('combobox', { name: 'Request a song' }).fill('Last Call');
    await drawer.getByRole('button', { name: /Last Call.* - Request$/ }).first().click();
    // both tabs keep looking for a spot every few seconds; wait for the song to join
    await expect.poll(async () => order((await api(server.base, 'GET', '/api/mix')).json).length, { timeout: 420_000, intervals: [3000] }).toBeGreaterThan(4);
    const after = order((await api(server.base, 'GET', '/api/mix')).json);
    const added = after.filter((id) => ![1, 2, 3, 4].includes(id));
    // every added song once, and the original four still once each
    expect(new Set(after).size, `mix ${after.join(',')}`).toBe(after.length);
    expect(added).toContain(12);
    await a.screenshot({ path: path.join(SHOTS, 'wp1-0103-08-tab-a-joined.png') });
    // a second join with exactly the same offer, from tab B, as a double click or a replay would send it
    const first = joins.find((join) => join.status === 200)!;
    expect(first, `joins seen: ${JSON.stringify(joins.map((join) => [join.tab, join.status]))}`).toBeTruthy();
    const replay = await b.evaluate(async (body) => (await fetch('/api/requests/insert', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, first.body);
    expect(replay).toBe(409);
    const final = order((await api(server.base, 'GET', '/api/mix')).json);
    expect(final).toEqual(after);
    const { json: left } = await api(server.base, 'GET', '/api/requests');
    expect((left.requests as unknown[]).length).toBe(0);
    console.log(JSON.stringify({ drill: 'S4-0103-08', joins: joins.map((join) => [join.tab, join.status]), replay, before: [1, 2, 3, 4], after: final }));
    await contextA.close();
    await contextB.close();
  } finally {
    await server.stop();
  }
});

test('S4-0102-09 Studio Apply in tab A after tab B moved the pair and switched draft: refused, the shape stays, the other draft untouched', async ({ browser }) => {
  const server = await startServer({ SELECTA_E2E_STEMS: '1' });
  try {
    const other = (await api(server.base, 'POST', '/api/drafts', { name: 'Other draft' })).json;
    const draft = other.id ?? other.draft?.id;
    for (const song of [5, 6, 7]) await api(server.base, 'POST', `/api/mix/songs?draft=${draft}`, { song_id: song });
    const otherBefore = (await api(server.base, 'GET', `/api/mix?draft=${draft}`)).json;
    const [contextA, a] = await tab(browser, server.base);
    const [contextB, b] = await tab(browser, server.base);
    await a.goto('/mix/current/edit');
    await a.getByRole('button', { name: 'Change', exact: true }).first().click();
    await a.getByRole('tab', { name: 'Studio' }).click();
    await a.getByRole('button', { name: 'Open the Studio' }).click();
    await expect(a.locator('.studio-cell').first()).toBeVisible({ timeout: 240_000 });
    await a.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
    // local work: one cell changed
    const cell = a.locator('.studio-cell').first();
    const before = await cell.getAttribute('aria-pressed') ?? await cell.getAttribute('aria-checked') ?? await cell.getAttribute('class');
    await cell.click();
    const changed = await cell.getAttribute('aria-pressed') ?? await cell.getAttribute('aria-checked') ?? await cell.getAttribute('class');
    expect(changed).not.toBe(before);
    // tab B: moves the first song down in the current mix (the Studio's pair changes), then switches to the other draft
    await b.goto('/mix/current/edit');
    await b.getByRole('button', { name: /^Move .+ down$/ }).first().click();
    await expect.poll(async () => order((await api(server.base, 'GET', '/api/mix')).json)[0], { timeout: 30_000 }).toBe(2);
    await b.goto(`/mixes/drafts/${draft}/edit`);
    await expect(b.getByRole('main')).toBeVisible();
    // tab A applies the shape made for the old pair
    await a.getByRole('button', { name: 'Apply to this transition' }).click();
    await expect(a.getByText(/nothing was applied|has changed|moved on|changed since/i).first()).toBeVisible({ timeout: 60_000 });
    // the shape is still in tab A, as changed
    const kept = a.locator('.studio-cell').first();
    if (await kept.count()) {
      const now = await kept.getAttribute('aria-pressed') ?? await kept.getAttribute('aria-checked') ?? await kept.getAttribute('class');
      expect(now).toBe(changed);
    }
    const stored = await a.evaluate(() => Object.keys(localStorage).filter((key) => /studio|shape/i.test(key)).length);
    await a.screenshot({ path: path.join(SHOTS, 'wp1-0102-09-tab-a-refused.png') });
    await b.screenshot({ path: path.join(SHOTS, 'wp1-0102-09-tab-b-other-draft.png') });
    // the other draft is exactly as it was
    const otherAfter = (await api(server.base, 'GET', `/api/mix?draft=${draft}`)).json;
    expect(order(otherAfter)).toEqual(order(otherBefore));
    expect(JSON.stringify(otherAfter.mix.map((item: { seam?: unknown }) => item.seam ?? null))).toBe(JSON.stringify(otherBefore.mix.map((item: { seam?: unknown }) => item.seam ?? null)));
    console.log(JSON.stringify({ drill: 'S4-0102-09', storedWorkingCopies: stored, otherDraft: order(otherAfter), current: order((await api(server.base, 'GET', '/api/mix')).json) }));
    await contextA.close();
    await contextB.close();
  } finally {
    await server.stop();
  }
});

test('S4-0107-09 the backend stops and restarts mid-session: no zero usage, and the app recovers', async ({ browser }) => {
  let server = await startServer();
  const [context, page] = await tab(browser, server.base);
  try {
    await page.goto('/workshop/storage');
    const usage = page.getByText(/ of .+ allowed$/).first();
    await expect(usage).toBeVisible({ timeout: 30_000 });
    const real = (await usage.textContent()) ?? '';
    // visit Analysis too, so its code is in the page before the server goes away
    await page.getByRole('link', { name: 'Analysis' }).first().click();
    await page.getByRole('link', { name: 'Storage' }).first().click();
    await expect(usage).toBeVisible();
    await server.stop();
    // the open page notices on its next look, and a fresh visit within the app can't read storage
    await expect(page.getByText(/Can’t reach SelectaDJ/).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('link', { name: 'Analysis' }).first().click();
    await page.getByRole('link', { name: 'Storage' }).first().click();
    await page.waitForTimeout(4000);
    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect(body).not.toMatch(/\b0(\.0+)? ?(B|KB|MB|GB)\b of /);
    const problem = await page.getByText(/Couldn’t read storage information|Can’t reach SelectaDJ/).count();
    expect(problem).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(SHOTS, 'wp1-0107-09-server-stopped.png') });
    // the same server comes back on the same port; the page recovers without a reload
    server = await startServer();
    const retry = page.getByRole('button', { name: /Try again/ }).first();
    if (await retry.count()) await retry.click().catch(() => {});
    await expect(page.getByText(/ of .+ allowed$/).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Can’t reach SelectaDJ/)).toHaveCount(0, { timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, 'wp1-0107-09-server-back.png') });
    console.log(JSON.stringify({ drill: 'S4-0107-09', before: real, whileDown: body.slice(0, 300), after: await page.getByText(/ of .+ allowed$/).first().textContent() }));
  } finally {
    await context.close();
    await server.stop();
  }
});

test('S4-0105-07 on page 200+ of a big library, readiness updates in place while analysis records results', async ({ browser }) => {
  test.setTimeout(900_000);
  const server = await startServer({ SELECTA_E2E_BULK: '20150' });
  const [context, page] = await tab(browser, server.base);
  try {
    const { json: first } = await api(server.base, 'GET', '/api/library?limit=1');
    expect(first.total).toBeGreaterThan(20_000);
    // the address a person gets after pressing "Show more songs" 200 times
    await page.goto('/library?pages=203', { timeout: 300_000 });
    const rows = page.locator('[data-library-page]');
    await expect.poll(async () => rows.count(), { timeout: 600_000, intervals: [5000] }).toBeGreaterThan(20_000);
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const shownPage = Number(await last.getAttribute('data-library-page'));
    expect(shownPage).toBeGreaterThanOrEqual(200);
    // the songs on the page being looked at, read from the page itself
    const onScreen = await page.evaluate(() => {
      const viewLine = window.innerHeight;
      return [...document.querySelectorAll<HTMLElement>('[data-library-page]')]
        .filter((row) => { const box = row.getBoundingClientRect(); return box.bottom > 0 && box.top < viewLine; })
        .map((row) => ({ text: row.innerText.split('\n')[0], id: row.querySelector('[data-focus-key^="song-details-"]')?.getAttribute('data-focus-key')?.replace('song-details-', '') }))
        .filter((row) => row.id);
    });
    expect(onScreen.length).toBeGreaterThan(0);
    const ids = onScreen.map((row) => Number(row.id));
    const visibleText = async () => (await page.evaluate((wanted) => wanted.map((id) => document.querySelector(`[data-focus-key="song-details-${id}"]`)?.closest('[data-library-page]')?.textContent ?? ''), ids)).join('|');
    const beforeText = await visibleText();
    await page.screenshot({ path: path.join(SHOTS, 'wp1-0105-07-deep-page-before.png') });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    // the worker finishes these songs now
    await api(server.base, 'POST', '/api/test/analysed', { ids });
    await expect.poll(visibleText, { timeout: 60_000, intervals: [2000] }).not.toBe(beforeText);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(200);
    expect(page.url()).toContain('pages=');
    await page.screenshot({ path: path.join(SHOTS, 'wp1-0105-07-deep-page-after.png') });
    console.log(JSON.stringify({ drill: 'S4-0105-07', total: first.total, shownPage, songsOnScreen: ids.length, scrollBefore, scrollAfter, before: beforeText.slice(0, 160), after: (await visibleText()).slice(0, 160) }));
  } finally {
    await context.close();
    await server.stop();
  }
});
