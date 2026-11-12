import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, Page, test } from '@playwright/test';
import { allRendered, covered, horizontalOverflow, out, OUT, resetStress, save, setTheme, STRESS_MIX } from './lib';

declare global { interface Window { audioSpy: { contexts: AudioContext[]; started: { at: number; when: number; offset: number; duration: number | null; length: number }[]; handlers: Record<string, unknown> } } }

async function spyOnAudio(page: Page) {
  await page.addInitScript(() => {
    const spy = { contexts: [] as AudioContext[], started: [] as { at: number; when: number; offset: number; duration: number | null; length: number }[], handlers: {} as Record<string, unknown> };
    (window as unknown as { audioSpy: typeof spy }).audioSpy = spy;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real { constructor(o?: AudioContextOptions) { super(o); spy.contexts.push(this); } };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function started(when = 0, offset = 0, duration?: number) {
      spy.started.push({ at: this.context.currentTime, when, offset, duration: duration ?? null, length: this.buffer?.duration ?? 0 });
      return duration === undefined ? start.call(this, when, offset) : start.call(this, when, offset, duration);
    };
    const session = navigator.mediaSession;
    if (session) {
      const set = session.setActionHandler.bind(session);
      session.setActionHandler = (action, handler) => { spy.handlers[action] = handler ? 'set' : null; set(action, handler); };
    }
  });
}

test('UF-0380-06 inspector geometry at 320, 400% zoom, short and desktop', async ({ page }) => {
  const r: Record<string, unknown> = {};
  for (const [width, height] of [[320, 568], [320, 200], [1280, 600], [1440, 900], [768, 1024]] as const) {
    await page.setViewportSize({ width, height });
    await setTheme(page, 'dark');
    await page.goto('/mix/current/edit');
    const change = page.getByRole('button', { name: 'Change', exact: true }).nth(1);
    await change.click();
    await expect(page.locator('.edit-inspector, .overlay-sheet').first()).toBeVisible();
    await page.waitForTimeout(500);
    const geometry = await page.evaluate(() => {
      const inspector = document.querySelector('.edit-inspector, .overlay-sheet') as HTMLElement;
      const ib = inspector.getBoundingClientRect();
      const selected = document.querySelector('.seam[aria-current], .seam.selected, .seam.is-selected, [data-selected="true"], .timeline > .seam:nth-of-type(2)') as HTMLElement | null;
      const sb = selected?.getBoundingClientRect();
      const overlap = (b: DOMRect) => Math.max(0, Math.min(b.right, ib.right) - Math.max(b.left, ib.left)) * Math.max(0, Math.min(b.bottom, ib.bottom) - Math.max(b.top, ib.top));
      const nav = [...document.querySelectorAll('nav a, nav button, .bottom-bar a, .bottom-bar button')].filter((n) => (n as HTMLElement).offsetParent !== null) as HTMLElement[];
      const navCovered = nav.filter((n) => {
        const b = n.getBoundingClientRect();
        if (b.bottom < 0 || b.top > innerHeight) return false;
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return hit && !(n === hit || n.contains(hit));
      }).map((n) => n.innerText.trim() || n.getAttribute('aria-label'));
      const close = [...inspector.querySelectorAll('button')].find((b) => /close|done|back/i.test(b.getAttribute('aria-label') ?? b.innerText));
      const cb = close?.getBoundingClientRect();
      return {
        inspector: [Math.round(ib.left), Math.round(ib.top), Math.round(ib.width), Math.round(ib.height)],
        modal: inspector.closest('[aria-modal="true"], dialog') !== null,
        selected: selected ? { cls: selected.className, box: [Math.round(sb!.left), Math.round(sb!.top), Math.round(sb!.width), Math.round(sb!.height)], overlap: Math.round(overlap(sb!)), inView: sb!.bottom > 0 && sb!.top < innerHeight } : null,
        navCovered, navCount: nav.length,
        close: close ? { name: close.getAttribute('aria-label') ?? close.innerText, inView: cb!.top >= 0 && cb!.bottom <= innerHeight } : null,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    r[`${width}x${height}`] = geometry;
    await page.screenshot({ path: out('geometry', `inspector-${width}x${height}.png`) });
    await page.keyboard.press('Escape');
  }
  save('geometry-inspector.json', r);
});

test('UF-0383-08 Requests drawer with a keyboard inset and at 400% zoom', async ({ page, request }) => {
  const r: Record<string, unknown> = {};
  await page.addInitScript(() => {
    let keyboard = 0;
    const events = new EventTarget();
    const view = {
      get width() { return window.innerWidth; }, get height() { return Math.max(window.innerHeight - keyboard, 0); },
      offsetTop: 0, offsetLeft: 0, scale: 1, onresize: null, onscroll: null,
      get pageTop() { return window.scrollY; }, get pageLeft() { return window.scrollX; },
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => view });
    (window as unknown as { keyboardTo: (h: number) => void }).keyboardTo = (h: number) => { keyboard = h; events.dispatchEvent(new Event('resize')); };
  });
  const mix = (await (await request.get('/api/mix')).json()).mix as { song_id: number; title: string; artist: string }[];
  const [first, second, third, fourth] = mix.map((item) => ({ id: item.song_id, title: item.title, artist: item.artist }));
  const rows = [
    { id: 901, song_id: fourth.id, title: fourth.title, artist: fourth.artist, status: 'pending', available: 1, stage: 'approve', needs_approval: true, bridge_choice: null, after: first.title, after_id: first.id, route: [{ ...third }, { ...fourth }], transitions: [{ from: first.title, to: third.title, key: 'a', status: 'waiting' }, { from: third.title, to: fourth.title, key: 'b', status: 'waiting' }] },
    { id: 902, song_id: second.id, title: second.title, artist: second.artist, status: 'pending', available: 1, stage: 'waiting', waiting_on: first.title, seconds: 95 },
  ];
  await page.route('**/api/requests', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { requests: rows } }) : route.continue()));
  for (const [width, height, keyboard] of [[375, 667, 300], [390, 844, 346], [320, 200, 0]] as const) {
    await page.setViewportSize({ width, height });
    await setTheme(page, 'dark');
    await page.goto('/listen');
    await page.getByRole('button', { name: /^Requests/ }).first().click();
    const drawer = page.getByRole('dialog', { name: 'Requests' });
    await expect(drawer).toBeVisible();
    const field = drawer.locator('input, textarea').first();
    const hasField = await field.count();
    if (hasField) await field.focus();
    if (keyboard) await page.evaluate((h) => (window as unknown as { keyboardTo: (h: number) => void }).keyboardTo(h), keyboard);
    await page.waitForTimeout(300);
    const controls = await drawer.evaluate((d) => [...d.querySelectorAll('button, input, select, a[href], [role="radio"]')].map((n) => (n.getAttribute('aria-label') ?? (n as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)));
    const reach: string[] = [];
    for (const handle of await drawer.locator('button, input, [role="radio"]').all()) {
      const problem = await handle.evaluate((node) => {
        node.scrollIntoView({ block: 'nearest' });
        const box = node.getBoundingClientRect();
        const bottom = window.visualViewport!.height;
        if (!box.width || !box.height) return '';
        const name = (node.getAttribute('aria-label') ?? (node as HTMLElement).innerText ?? '').trim().slice(0, 40);
        if (box.top < -0.5 || box.bottom > bottom + 0.5) return `${name}: ${Math.round(box.top)}-${Math.round(box.bottom)} outside 0-${Math.round(bottom)}`;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit && (hit === node || node.contains(hit)) ? '' : `${name}: covered by ${hit?.tagName}.${hit?.className}`;
      });
      if (problem) reach.push(problem);
    }
    r[`${width}x${height} kb${keyboard}`] = { hasField, controls, reach, overflow: await horizontalOverflow(page) };
    await page.screenshot({ path: out('geometry', `requests-${width}x${height}-kb${keyboard}.png`) });
    if (keyboard) await page.evaluate(() => (window as unknown as { keyboardTo: (h: number) => void }).keyboardTo(0));
  }
  save('geometry-requests.json', r);
});

test('media session, audio ownership, countdown against the audio clock', async ({ page, request }) => {
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'dark');
  await resetStress(request, STRESS_MIX);
  await allRendered(request);
  const r: Record<string, unknown> = {};
  await page.goto('/listen');
  const button = page.locator('.now .transport .primary');
  await button.click();
  await expect(button).toHaveText('Pause', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const session = () => page.evaluate(() => ({
    title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, album: navigator.mediaSession.metadata?.album,
    state: navigator.mediaSession.playbackState, handlers: Object.keys(window.audioSpy.handlers).filter((k) => window.audioSpy.handlers[k]),
    shown: (document.querySelector('.now h1, .now .now-title, .now [class*="title"]') as HTMLElement | null)?.innerText?.trim(),
    contexts: window.audioSpy.contexts.map((c) => c.state),
  }));
  r.playing = await session();
  await button.click();
  await page.waitForTimeout(800);
  r.paused = await session();
  await button.click();
  await page.waitForTimeout(800);

  // countdown and transition scene against the real audio clock, sampled for 100 seconds
  const samples: unknown[] = [];
  for (let i = 0; i < 200; i += 1) {
    samples.push(await page.evaluate(() => {
      const ctx = window.audioSpy.contexts.find((c) => c.state === 'running');
      const timer = document.querySelector('.handoff.countdown');
      const active = document.querySelector('.handoff.active');
      const slider = document.querySelector('[role="slider"][aria-label="Where in the song"]');
      return { now: performance.now(), ctx: ctx?.currentTime ?? null, countdown: timer?.getAttribute('aria-label') ?? null, active: active?.getAttribute('aria-label') ?? null, pending: document.querySelector('.handoff.pending')?.textContent ?? null, pos: slider?.getAttribute('aria-valuenow') ?? null, title: (document.querySelector('.now h1') as HTMLElement | null)?.innerText ?? null };
    }));
    await page.waitForTimeout(500);
  }
  r.samples = samples;
  r.started = await page.evaluate(() => window.audioSpy.started);

  // audio ownership: open the Studio from the inspector while the mix plays, and play its preview
  await page.getByRole('link', { name: /Edit|Mix/ }).first().click().catch(() => undefined);
  await page.goto('/mix/current/edit');
  const before = await page.evaluate(() => ({ started: window.audioSpy.started.length, contexts: window.audioSpy.contexts.map((c) => c.state) }));
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 90_000 });
  const playStudio = page.locator('.studio').getByRole('button', { name: /^(Play|Hear)/ }).first();
  const studioPlayName = await playStudio.innerText().catch(() => 'none');
  await playStudio.click().catch(() => undefined);
  await page.waitForTimeout(2500);
  const during = await page.evaluate(() => ({ contexts: window.audioSpy.contexts.map((c) => c.state), started: window.audioSpy.started.slice(-4), mini: (document.querySelector('.mini-player, .player') as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').slice(0, 120) }));
  const stopStudio = page.locator('.studio').getByRole('button', { name: /^(Stop|Pause)/ }).first();
  await stopStudio.click().catch(() => undefined);
  await page.waitForTimeout(2500);
  const afterStop = await page.evaluate(() => ({ contexts: window.audioSpy.contexts.map((c) => c.state), started: window.audioSpy.started.length, mini: (document.querySelector('.mini-player, .player') as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').slice(0, 120) }));
  r.studio = { before, studioPlayName, during, afterStop };
  r.sessionAfterStudio = await session();
  save('audio-browser.json', r);

  // the rendered transitions on disk, for measurement
  const homes = readdirSync(tmpdir()).filter((n) => n.startsWith('selecta-e2e-')).map((n) => join(tmpdir(), n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const renders = join(homes[0], 'renders');
  const target = join(OUT, 'audio');
  mkdirSync(target, { recursive: true });
  const copied: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(flac|wav|ogg|mp3|opus|m4a)$/i.test(name) && copied.length < 40) { copyFileSync(full, join(target, `${copied.length}-${name}`)); copied.push(full.slice(homes[0].length)); }
    }
  };
  walk(renders);
  save('audio-files.json', { home: 'temp selecta-e2e-*', copied });
});
