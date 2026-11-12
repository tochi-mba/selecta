// TEMPORARY probe for Claude's owner-delegated verification (tag va-). Deleted after the run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { allRendered, resetMix, rewriteJson } from './helpers';

const OUT = process.env.VA_OUT ?? 'va-out';
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${process.env.SELECTA_E2E_PORT ?? '8799'}`;
const STRESS_MIX = [8, 15, 18, 19, 20, 10, 17, 16];
const save = (name: string, value: unknown) => writeFileSync(join(OUT, `r-${name}.json`), JSON.stringify(value, null, 2));
const errors: Record<string, string> = {};
async function attempt(key: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { errors[key] = String(e).slice(0, 400); save('errors', errors); }
}
async function prefs(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.goto(`${BASE}/mixes`);
  await page.evaluate((t) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: t, motion: 'still' })), theme);
}
async function settle(page: Page) {
  await page.locator('main#main:not([aria-busy="true"])').first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
}
async function play(page: Page) {
  await page.goto(`${BASE}/listen`);
  const button = page.locator('.now .transport .primary');
  await button.click();
  await expect(button).toHaveText('Pause', { timeout: 60_000 });
}
const box = (page: Page, sel: string) => page.locator(sel).first().boundingBox().catch(() => null);

test('devices', async ({ browser, request }) => {
  test.setTimeout(1_200_000);
  await resetMix(request, [16, ...STRESS_MIX]);
  await allRendered(request);
  const r: Record<string, unknown> = {};
  const phones: Array<[string, Parameters<Browser['newContext']>[0]]> = [
    ['pixel7', devices['Pixel 7']],
    ['pixel7-land', devices['Pixel 7 landscape']],
    ['w320', { ...devices['Pixel 7'], viewport: { width: 320, height: 640 } }],
    ['w390', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }],
    ['w430', { ...devices['Pixel 7'], viewport: { width: 430, height: 932 } }],
  ];
  for (const [name, options] of phones) {
    const ctx = await browser.newContext(options);
    const page = await ctx.newPage();
    await attempt(`phone-${name}`, async () => {
      await prefs(page, name === 'w390' ? 'dark' : 'light');
      await play(page);
      await page.goto(`${BASE}/library`); await settle(page);
      const m = await page.evaluate(() => {
        const rect = (s: string) => { const n = document.querySelector(s); if (!n) return null; const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height }; };
        const mini = document.querySelector('.mini');
        const parts = mini ? [...mini.querySelectorAll('a, button, .mini-song *')].map((n) => { const b = n.getBoundingClientRect(); return { t: (n.getAttribute('aria-label') ?? n.textContent ?? '').slice(0, 30), l: b.left, r: b.right, top: b.top, b: b.bottom, w: b.width, h: b.height }; }) : [];
        const small = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, [role="tab"]')].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(n).visibility !== 'hidden' && (b.height < 44 || b.width < 44) && !n.closest('[aria-hidden="true"]') && !n.closest('p'); }).map((n) => `${(n.getAttribute('aria-label') ?? n.textContent ?? '').trim().slice(0, 30)} ${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)}`);
        return { vw: innerWidth, vh: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, mini: rect('.mini'), nav: rect('nav.tabs, .bottom-nav, nav[aria-label]'), miniTitle: rect('.mini-song'), parts, smallTargets: small.slice(0, 25), smallCount: small.length };
      });
      await page.screenshot({ path: join(OUT, `d-${name}-library.png`) });
      // last row reachable above the chrome
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(500);
      m.lastRow = await page.evaluate(() => { const rows = document.querySelectorAll('main li, main tr, main [role="row"]'); const last = rows[rows.length - 1]; const mini = document.querySelector('.mini')?.getBoundingClientRect(); const lb = last?.getBoundingClientRect(); return lb ? { bottom: lb.bottom, miniTop: mini?.top ?? null, vh: innerHeight } : null; });
      await page.screenshot({ path: join(OUT, `d-${name}-library-end.png`) });
      const more = page.locator('.nav-more-mobile');
      if (await more.isVisible()) {
        await more.tap();
        await page.waitForTimeout(600);
        m.moreLinks = await page.getByRole('dialog').getByRole('link').allTextContents().catch(() => []);
        await page.screenshot({ path: join(OUT, `d-${name}-more.png`) });
        await page.keyboard.press('Escape');
      } else m.moreLinks = 'more button not visible';
      // focused input not covered
      await page.goto(`${BASE}/library`); await settle(page);
      const search = page.getByRole('searchbox').first();
      if (await search.count()) { await search.tap(); m.searchBox = await search.boundingBox(); }
      r[name] = m;
    });
    // stage on small screen
    if (name === 'w320' || name === 'pixel7-land') await attempt(`stage-${name}`, async () => {
      await page.goto(`${BASE}/listen`); await settle(page);
      const before = await page.getByRole('slider', { name: 'Where in the song' }).getAttribute('aria-valuetext');
      await page.locator('[data-stage-launcher]').evaluate((n) => { for (let u = n.parentElement; u; u = u.parentElement) if (u.tagName === 'DETAILS') (u as HTMLDetailsElement).open = true; });
      await page.locator('[data-stage-launcher]').tap();
      await expect(page.locator('.stage-controls')).toBeVisible();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, `d-${name}-stage.png`) });
      const stageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
      const focus = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.outerHTML.slice(0, 120));
      const after = await page.getByRole('slider', { name: 'Where in the song' }).getAttribute('aria-valuetext').catch(() => null);
      const playing = await page.locator('.now .transport .primary').textContent();
      r[`stage-${name}`] = { before, after, focus, playing, stageOverflow };
    });
    await ctx.close();
  }
  // WebKit iPhone
  await attempt('webkit', async () => {
    let wk: Browser | null = null;
    try { wk = await webkit.launch(); } catch (e) { r.webkit = `launch failed: ${String(e).slice(0, 200)}`; return; }
    for (const name of ['iPhone 13', 'iPhone 13 landscape', 'iPhone SE'] as const) {
      const ctx = await wk.newContext(devices[name]);
      const page = await ctx.newPage();
      await prefs(page, 'dark');
      await page.goto(`${BASE}/library`); await settle(page);
      const slug = name.replace(/ /g, '-');
      await page.screenshot({ path: join(OUT, `d-wk-${slug}-library.png`) });
      await page.goto(`${BASE}/mix/current/edit`); await settle(page);
      await page.screenshot({ path: join(OUT, `d-wk-${slug}-edit.png`) });
      r[`wk-${slug}`] = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, vw: innerWidth }));
      await ctx.close();
    }
    await wk.close();
  });
  // zoom 200 / 400 (CSS viewport of a 1280x800 window), inspector and long names
  for (const [label, w, h, dsf] of [['z200', 640, 400, 2], ['z400', 320, 200, 4]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    await attempt(label, async () => {
      await prefs(page);
      const z: Record<string, unknown> = {};
      for (const [id, path] of [['library', '/library'], ['edit', '/mix/current/edit']] as const) {
        await page.goto(`${BASE}${path}`); await settle(page);
        z[`${id}-overflow`] = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        z[`${id}-truncated-without-full`] = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main *')].filter((n) => n.children.length === 0 && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).textOverflow === 'ellipsis').filter((n) => !n.title && !n.closest('[title]') && !n.getAttribute('aria-label')).map((n) => n.textContent?.slice(0, 40)).slice(0, 10));
        await page.screenshot({ path: join(OUT, `z-${label}-${id}.png`) });
      }
      await page.getByRole('button', { name: 'Change', exact: true }).first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, `z-${label}-inspector.png`) });
      const close = page.getByRole('button', { name: /Close|Done|Back/ }).first();
      z.inspectorClose = await close.isVisible().catch(() => false) ? await close.boundingBox() : 'no close visible';
      z.inspectorOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      r[label] = z;
    });
    await ctx.close();
  }
  // inspector separator by keyboard at desktop and at 200%
  for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await attempt(`sep-${w}`, async () => {
      await prefs(page);
      await page.goto(`${BASE}/mix/current/edit`); await settle(page);
      await page.getByRole('button', { name: 'Change', exact: true }).first().click();
      const sep = page.getByRole('separator').first();
      await sep.focus();
      const v0 = await sep.getAttribute('aria-valuenow');
      for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
      const v1 = await sep.getAttribute('aria-valuenow');
      for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
      const v2 = await sep.getAttribute('aria-valuenow');
      const timeline = await page.evaluate(() => { const n = document.querySelector('.edit-main, .mix-timeline, .timeline, .edit-list'); return n ? n.getBoundingClientRect().width : null; });
      await page.reload(); await settle(page);
      await page.getByRole('button', { name: 'Change', exact: true }).first().click();
      const v3 = await page.getByRole('separator').first().getAttribute('aria-valuenow');
      r[`sep-${w}`] = { v0, minAfterLeft: v1, maxAfterRight: v2, afterReload: v3, timeline, label: await sep.getAttribute('aria-label') };
      await page.screenshot({ path: join(OUT, `sep-${w}.png`) });
    });
    await ctx.close();
  }
  // touch: target sizes and tap reorder in the editor
  {
    const ctx = await browser.newContext(devices['Pixel 7']);
    const page = await ctx.newPage();
    await attempt('touch-reorder', async () => {
      await resetMix(request, [1, 2, 3, 4, 5]);
      await prefs(page);
      await page.goto(`${BASE}/mix/current/edit`); await settle(page);
      const before = ((await (await request.get(`${BASE}/api/mix`)).json()).mix as { id: number }[]).map((s) => s.id);
      const down = page.getByRole('button', { name: /Move .* (down|later)/i }).first();
      const label = await down.getAttribute('aria-label').catch(() => null);
      const bb = await down.boundingBox();
      await down.tap();
      await page.waitForTimeout(1500);
      const after = ((await (await request.get(`${BASE}/api/mix`)).json()).mix as { id: number }[]).map((s) => s.id);
      const focus = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? document.activeElement?.textContent?.slice(0, 40));
      await page.screenshot({ path: join(OUT, 'd-touch-reorder.png') });
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a[href], main [role="tab"], .mini button, nav a, nav button')].filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.height < 44 || b.width < 44); }).map((n) => `${(n.getAttribute('aria-label') ?? n.textContent ?? '').trim().slice(0, 30)} ${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)}`));
      r.touch = { before, after, label, bb, focus, coarse, smallTargetsInEditor: small };
    });
    await ctx.close();
  }
  // short height with on-screen keyboard emulated by a short viewport; dialog actions reachable
  {
    const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 360 } });
    const page = await ctx.newPage();
    await attempt('short-dialog', async () => {
      await resetMix(request, STRESS_MIX);
      await prefs(page);
      await page.goto(`${BASE}/mix/current/edit`); await settle(page);
      await page.getByRole('button', { name: 'Download audio' }).first().tap();
      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      const buttons = await dialog.getByRole('button').evaluateAll((ns) => ns.map((n) => { const b = n.getBoundingClientRect(); return { t: (n.getAttribute('aria-label') ?? n.textContent ?? '').trim().slice(0, 30), top: Math.round(b.top), bottom: Math.round(b.bottom), inView: b.top >= 0 && b.bottom <= innerHeight }; }));
      await page.screenshot({ path: join(OUT, 'd-short-dialog.png') });
      r.shortDialog = buttons;
    });
    await ctx.close();
  }
  // server gone
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await attempt('server-gone', async () => {
      await prefs(page);
      await page.goto(`${BASE}/library`); await settle(page);
      await ctx.route('**/api/**', (route) => route.abort('connectionrefused'));
      await page.reload();
      await page.waitForTimeout(6000);
      r.serverGone = (await page.locator('body').innerText()).slice(0, 600);
      await page.screenshot({ path: join(OUT, 'd-server-gone.png') });
      r.manifest = (await request.get(`${BASE}/manifest.webmanifest`)).status();
    });
    await ctx.close();
  }
  // media session, two tabs, freeze and wake, canvas work while hidden and theme switch
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      const w = window as unknown as { __va: { actions: string[]; draws: number; frames: number } };
      w.__va = { actions: [], draws: 0, frames: 0 };
      const ms = navigator.mediaSession;
      if (ms) { const orig = ms.setActionHandler.bind(ms); ms.setActionHandler = (a, h) => { if (h) w.__va.actions.push(a); return orig(a, h); }; }
      for (const m of ['fillRect', 'clearRect', 'stroke', 'fill', 'drawImage'] as const) { const p = CanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>; const o = p[m]; p[m] = function (this: unknown, ...a: unknown[]) { w.__va.draws++; return o.apply(this, a); }; }
      const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => { w.__va.frames++; cb(t); });
    });
    const a = await ctx.newPage();
    await attempt('media-tabs', async () => {
      await resetMix(request, STRESS_MIX);
      await prefs(a, 'dark');
      await play(a);
      await a.waitForTimeout(1500);
      r.mediaSession = await a.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, state: navigator.mediaSession.playbackState, actions: (window as unknown as { __va: { actions: string[] } }).__va.actions }));
      // theme switch while playing: long tasks and continuity
      const read = () => a.evaluate(() => ({ ...(window as unknown as { __va: object }).__va, vis: document.visibilityState }));
      const t0 = await a.getByRole('slider', { name: 'Where in the song' }).getAttribute('aria-valuetext');
      const perf = await a.evaluate(async () => {
        const longs: number[] = [];
        const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(Math.round(e.duration))));
        po.observe({ type: 'longtask', buffered: false });
        const gaps: number[] = []; let last = performance.now(); let run = true;
        const tick = (t: number) => { gaps.push(t - last); last = t; if (run) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const html = document.documentElement;
        for (let i = 0; i < 6; i++) {
          const p = JSON.parse(localStorage.getItem('selecta.prefs') ?? '{}');
          const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
          localStorage.setItem('selecta.prefs', JSON.stringify({ ...p, theme: next }));
          window.dispatchEvent(new StorageEvent('storage', { key: 'selecta.prefs' }));
          const btn = [...document.querySelectorAll('button')].find((b) => /theme|Light|Dark/i.test(b.getAttribute('aria-label') ?? ''));
          if (btn) (btn as HTMLButtonElement).click();
          await new Promise((res) => setTimeout(res, 500));
        }
        run = false; po.disconnect();
        gaps.sort((x, y) => x - y);
        return { longTasks: longs, frames: gaps.length, p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0), max: Math.round(gaps[gaps.length - 1] ?? 0), theme: html.dataset.theme };
      });
      const t1 = await a.getByRole('slider', { name: 'Where in the song' }).getAttribute('aria-valuetext');
      r.themeSwitch = { ...perf, t0, t1, playing: await a.locator('.now .transport .primary').textContent() };
      // hidden tab: does canvas work stop?
      const v0 = await read();
      const b = await ctx.newPage();
      await b.goto(`${BASE}/library`);
      await b.bringToFront();
      await a.waitForTimeout(3000);
      const v1 = await read();
      r.hidden = { before: v0, after: v1, drawsWhileHidden: (v1 as { draws: number }).draws - (v0 as { draws: number }).draws, framesWhileHidden: (v1 as { frames: number }).frames - (v0 as { frames: number }).frames };
      // second tab plays: first pauses
      await play(b);
      await b.waitForTimeout(2500);
      r.twoTabs = { aButton: await a.locator('.now .transport .primary').textContent(), bButton: await b.locator('.now .transport .primary').textContent() };
      // freeze and wake tab b
      const cdp = await ctx.newCDPSession(b);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await a.waitForTimeout(4000);
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      await b.waitForTimeout(3000);
      r.freezeWake = { aButton: await a.locator('.now .transport .primary').textContent(), bButton: await b.locator('.now .transport .primary').textContent(), bTime: await b.getByRole('slider', { name: 'Where in the song' }).getAttribute('aria-valuetext') };
      await b.screenshot({ path: join(OUT, 'd-after-wake.png') });
    });
    await ctx.close();
  }
  // 100-song perf
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await attempt('perf100', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20][i % 18]);
      await request.post(`${BASE}/api/mix/clear`);
      for (const id of ids) await request.post(`${BASE}/api/mix/songs`, { data: { song_id: id } });
      await prefs(page);
      const t0 = Date.now();
      await page.goto(`${BASE}/mix/current/edit`);
      await expect(page.locator('main#main:not([aria-busy="true"])').first()).toBeVisible();
      const open = Date.now() - t0;
      const rows = await page.locator('.song-select').count();
      const inp = await page.evaluate(async () => {
        const out: number[] = [];
        const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => out.push(Math.round((e as PerformanceEventTiming).duration))));
        po.observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
        (window as unknown as { __inp: number[] }).__inp = out;
        return true;
      });
      const first = page.locator('.song-select').nth(40);
      await first.focus();
      const moves: number[] = [];
      for (let i = 0; i < 5; i++) { const s = Date.now(); await page.keyboard.press('Alt+ArrowDown'); await page.waitForTimeout(50); moves.push(Date.now() - s); }
      const scroll = await page.evaluate(async () => {
        const gaps: number[] = []; let last = performance.now(); let run = true;
        const tick = (t: number) => { gaps.push(t - last); last = t; if (run) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        for (let y = 0; y < 8000; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
        run = false; gaps.sort((a, b) => a - b);
        return { p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), max: Math.round(gaps[gaps.length - 1]) };
      });
      const events = await page.evaluate(() => (window as unknown as { __inp: number[] }).__inp);
      const focus = await page.evaluate(() => document.activeElement?.className);
      r.perf100 = { open, rows, inp, events, moves, scroll, focus, cores: await page.evaluate(() => navigator.hardwareConcurrency) };
    });
    await ctx.close();
  }
  save('devices', r);
});

test('screen reader and keyboard', async ({ browser, request }) => {
  test.setTimeout(900_000);
  await resetMix(request, STRESS_MIX);
  await allRendered(request);
  const r: Record<string, unknown> = {};
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await prefs(page);
  // reading order of a song row
  await attempt('rows', async () => {
    await play(page);
    r.listenAria = await page.locator('main#main').ariaSnapshot();
    await page.goto(`${BASE}/mix/current/edit`); await settle(page);
    r.editRow = await page.locator('main li, main [role="row"], main [role="listitem"]').filter({ has: page.locator('.song-select') }).first().ariaSnapshot().catch(async () => page.locator('.song-select').first().locator('xpath=..').ariaSnapshot());
    await page.goto(`${BASE}/library`); await settle(page);
    r.libraryRow = await page.getByRole('checkbox', { name: /^Select recording/ }).first().locator('xpath=ancestor::*[self::li or self::tr or @role="row"][1]').ariaSnapshot().catch((e) => String(e).slice(0, 200));
    r.miniAria = await page.locator('aside.mini').ariaSnapshot().catch(() => null);
  });
  // rail current page
  await attempt('rail', async () => {
    const out: Record<string, unknown> = {};
    for (const path of ['/mixes', '/mixes/mine', '/library', '/listen', '/mix/current/edit', '/workshop', '/workshop/storage']) {
      await page.goto(`${BASE}${path}`); await settle(page);
      out[path] = await page.locator('nav [aria-current]').evaluateAll((ns) => ns.map((n) => `${n.getAttribute('aria-label') ?? n.textContent?.trim()}=${n.getAttribute('aria-current')}`));
    }
    r.rail = out;
    await page.goto(`${BASE}/library`); await settle(page);
    r.navAria = await page.getByRole('navigation').first().ariaSnapshot();
  });
  // blocker announcement
  await attempt('blocker', async () => {
    const p = await ctx.newPage();
    await p.route('**/api/jobs', (route) => rewriteJson(route, (body) => ({ ...body, storage_full: true, analysis: { ...body.analysis, paused: true, left: 5 } })));
    await p.goto(`${BASE}/library`);
    const said: string[] = [];
    for (let i = 0; i < 12; i++) {
      await p.waitForTimeout(1000);
      const t = await p.locator('[aria-live]').evaluateAll((ns) => ns.map((n) => n.textContent?.trim()).filter(Boolean));
      said.push(t.join(' | '));
    }
    const link = p.locator('.health-attention');
    const linkLabel = await link.getAttribute('aria-label').catch(() => null);
    await link.focus().catch(() => {});
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1000);
    r.blocker = { said: [...new Set(said)], linkLabel, url: p.url() };
    await p.close();
  });
  // menu, tabs, tooltip by keyboard
  await attempt('menus', async () => {
    const out: Record<string, unknown> = {};
    await page.goto(`${BASE}/library`); await settle(page);
    const trigger = page.locator('[aria-haspopup="menu"]').first();
    out.trigger = await trigger.getAttribute('aria-label') ?? await trigger.textContent();
    await trigger.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    out.expanded = await trigger.getAttribute('aria-expanded');
    out.focusInMenu = await page.evaluate(() => document.activeElement?.getAttribute('role'));
    await page.keyboard.press('ArrowDown');
    out.afterDown = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    out.focusAfterEscape = await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup'));
    out.expandedAfter = await trigger.getAttribute('aria-expanded');
    await page.goto(`${BASE}/mix/current/edit`); await settle(page);
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    const tab = page.getByRole('tab').first();
    await tab.focus();
    const sel0 = await page.getByRole('tab').evaluateAll((ns) => ns.map((n) => `${n.textContent?.trim()}:${n.getAttribute('aria-selected')}`));
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    const sel1 = await page.getByRole('tab').evaluateAll((ns) => ns.map((n) => `${n.textContent?.trim()}:${n.getAttribute('aria-selected')}`));
    out.tabs = { sel0, sel1, focus: await page.evaluate(() => document.activeElement?.getAttribute('role')) };
    // tooltip on a rail link: focus shows, Escape hides
    await page.goto(`${BASE}/library`); await settle(page);
    const tipHost = page.locator('[data-tip]').first();
    await tipHost.focus(); await page.waitForTimeout(500);
    out.tipVisible = await page.locator('[role="tooltip"]').evaluateAll((ns) => ns.filter((n) => (n as HTMLElement).offsetParent !== null).map((n) => n.textContent));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    out.tipAfterEscape = await page.locator('[role="tooltip"]').evaluateAll((ns) => ns.filter((n) => (n as HTMLElement).offsetParent !== null).map((n) => n.textContent));
    // trap check: Tab 120 times on the editor and record unique focus targets and whether focus ever leaves main
    await page.goto(`${BASE}/mix/current/edit`); await settle(page);
    const seen: string[] = [];
    for (let i = 0; i < 150; i++) { await page.keyboard.press('Tab'); seen.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName}:${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 24)}` : 'none'; })); }
    out.tabWalk = { unique: new Set(seen).size, wrappedToBody: seen.includes('BODY:'), sample: seen.slice(0, 40) };
    r.menus = out;
  });
  // whole-mix action audit by keyboard
  await attempt('actions', async () => {
    await page.goto(`${BASE}/mix/current/edit`); await settle(page);
    const header: string[] = [];
    await page.locator('main h1').first().click();
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); header.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim().slice(0, 40))); }
    r.currentActions = header;
    r.currentButtons = await page.locator('main').getByRole('button').evaluateAll((ns) => ns.slice(0, 30).map((n) => n.textContent?.trim().slice(0, 30)));
  });
  // problem jump on 100 songs with one failed seam
  await attempt('problem', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20][i % 18]);
    await request.post(`${BASE}/api/mix/clear`);
    for (const id of ids) await request.post(`${BASE}/api/mix/songs`, { data: { song_id: id } });
    const p = await ctx.newPage();
    await p.route('**/api/mix', (route) => route.request().method() === 'GET' ? rewriteJson(route, (body) => { const m = body.mix; for (let i = 1; i < m.length; i++) if (m[i].seam) m[i].seam.state = { ...m[i].seam.state, status: i === 63 ? 'failed' : 'ready', error: i === 63 ? 'synthetic failure' : undefined }; return body; }) : route.continue());
    await p.goto(`${BASE}/mix/current/edit`); await settle(p);
    const jump = p.getByRole('button', { name: /Jump to first problem/ });
    const visible = await jump.isVisible();
    let walk = 0;
    await p.locator('main h1').first().click();
    for (; walk < 40; walk++) { await p.keyboard.press('Tab'); if (await p.evaluate(() => /Jump to first problem/.test(document.activeElement?.textContent ?? ''))) break; }
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1200);
    const after = await p.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { tag: a?.tagName, label: (a?.getAttribute('aria-label') ?? a?.textContent ?? '').trim().slice(0, 80), inInspector: !!a?.closest('.edit-inspector, .overlay-sheet, [role="dialog"], aside') }; });
    const live = await p.locator('[aria-live]').evaluateAll((ns) => ns.map((n) => n.textContent?.trim()).filter(Boolean));
    const inspectorText = (await p.locator('.edit-inspector, .overlay-sheet').first().innerText().catch(() => '')).slice(0, 300);
    await p.screenshot({ path: join(OUT, 'sr-problem-jump.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    const afterEscape = await p.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim().slice(0, 60));
    r.problem = { visible, tabsToReach: walk + 1, after, live, inspectorText, afterEscape };
    await p.close();
    await resetMix(request, STRESS_MIX);
  });
  // forced colours: boundaries are drawn with system colours
  await attempt('forced', async () => {
    await page.emulateMedia({ forcedColors: 'active' });
    const out: Record<string, unknown> = {};
    for (const path of ['/library', '/mix/current/edit']) {
      await page.goto(`${BASE}${path}`); await settle(page);
      await page.getByRole('checkbox', { name: /^Select recording/ }).first().check().catch(() => {});
      await page.locator('.song-select').first().click().catch(() => {});
      out[path] = await page.evaluate(() => {
        const desc = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].slice(0, 3).map((n) => { const s = getComputedStyle(n); return { sel, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, bg: s.backgroundColor, color: s.color }; });
        return [...desc('button'), ...desc('[aria-pressed="true"]'), ...desc('[aria-current="true"]'), ...desc('.pill, .status'), ...desc('input[type="checkbox"]:checked'), ...desc('button:disabled')];
      });
    }
    r.forced = out;
    await page.emulateMedia({ forcedColors: 'none' });
  });
  // axe both themes
  await attempt('axe', async () => {
    const out: Record<string, unknown> = {};
    for (const theme of ['light', 'dark'] as const) {
      await prefs(page, theme);
      await page.emulateMedia({ colorScheme: theme });
      for (const path of ['/mixes', '/library', '/mix/current/edit', '/listen', '/workshop']) {
        await page.goto(`${BASE}${path}`); await settle(page);
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        out[`${theme} ${path}`] = res.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`);
      }
    }
    r.axe = out;
  });
  save('sr', r);
  await ctx.close();
});
