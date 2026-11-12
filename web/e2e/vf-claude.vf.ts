/* Temporary Claude verification captures (owner-delegated person steps, 2026-11-12). Deleted after use. */
import AxeBuilder from '@axe-core/playwright';
import { Browser, devices, expect, Page, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetMix, soundsStarted, spyOnAudio } from './helpers';

const OUT = process.env.VF_OUT ?? 'vf-out';
const ROUTES = [
  ['listen', '/listen'], ['mixes', '/mixes'], ['my-mixes', '/mixes/mine'], ['editor', '/mix/current/edit'],
  ['library', '/library'], ['discover', '/discover'], ['harmonic', '/discover/harmonic'], ['workshop', '/workshop'],
  ['diagnostics', '/workshop/diagnostics'], ['listening', '/listening'], ['lucy', '/mixes/lucy'],
] as const;
const save = (name: string, data: unknown) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

test.beforeEach(async ({ request }) => {
  await resetMix(request, [8, 15, 18, 19, 20, 10, 17, 16]);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

async function ready(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

const overflow = (page: Page) => page.evaluate(() => {
  const doc = document.documentElement;
  const wide: string[] = [];
  if (doc.scrollWidth > doc.clientWidth + 1) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
      const r = el.getBoundingClientRect();
      if (r.right > doc.clientWidth + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed') {
        wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
        if (wide.length > 5) break;
      }
    }
  }
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide };
});

async function shoot(browser: Browser, theme: 'light' | 'dark', width: number, extra: Record<string, unknown> = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, colorScheme: theme, reducedMotion: 'reduce', ...extra });
  return { context, page: await context.newPage() };
}

test('routes: light and dark at 320, 768 and 1440, axe and overflow', async ({ browser }) => {
  const report: Record<string, unknown>[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 768, 1440]) {
      const { context, page } = await shoot(browser, theme, width);
      for (const [name, address] of ROUTES) {
        try {
          await page.goto(address);
          await ready(page);
          await page.screenshot({ path: join(OUT, 'routes', `${name}-${theme}-${width}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
          const row: Record<string, unknown> = { name, theme, width, overflow: await overflow(page) };
          if (width !== 768) {
            const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
            row.axe = violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${String(n.target)}`));
          }
          report.push(row);
        } catch (error) {
          report.push({ name, theme, width, error: String(error).slice(0, 300) });
        }
      }
      await context.close();
    }
  }
  save('routes.json', report);
});

test('accessibility tree, tab order and live regions on every route', async ({ browser }) => {
  const { context, page } = await shoot(browser, 'light', 1440);
  const out: Record<string, unknown> = {};
  for (const [name, address] of ROUTES) {
    try {
      await page.goto(address);
      await ready(page);
      const tree = await page.locator('body').ariaSnapshot();
      save(`aria-${name}.yaml`, tree);
      const live = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log],[role=timer]')).map((el) => ({
        role: el.getAttribute('role'), live: el.getAttribute('aria-live'), atomic: el.getAttribute('aria-atomic'), text: (el.textContent ?? '').trim().slice(0, 80),
      })));
      await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const tabs: string[] = [];
      for (let n = 0; n < 40; n += 1) {
        await page.keyboard.press('Tab');
        tabs.push(await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return '(body)';
          const s = getComputedStyle(el);
          const ring = s.outlineStyle !== 'none' && s.outlineWidth !== '0px' ? 'outline' : s.boxShadow !== 'none' ? 'shadow' : 'NO-RING';
          const r = el.getBoundingClientRect();
          const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
          const inView = r.bottom > 0 && r.top < innerHeight && r.width > 0;
          return `${el.tagName.toLowerCase()}[${el.getAttribute('role') ?? ''}] "${name}" ${ring}${inView ? '' : ' OFFSCREEN'}`;
        }));
      }
      out[name] = { live, tabs, headings: await page.locator('h1, h2, h3').allInnerTexts(), landmarks: await page.locator('main, nav, header, footer, aside, [role=region], [role=search]').evaluateAll((els) => els.map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? ''}`)) };
    } catch (error) {
      out[name] = { error: String(error).slice(0, 300) };
    }
  }
  save('a11y.json', out);
  await context.close();
});

test('overlays: focus in, trapped, Escape closes, focus returns', async ({ browser }) => {
  const { context, page } = await shoot(browser, 'dark', 1440);
  const results: Record<string, unknown>[] = [];
  const probe = async (label: string, open: () => Promise<void>, dialogName: RegExp | string) => {
    try {
      await open();
      const dialog = page.getByRole('dialog', { name: dialogName });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(300);
      const insideAtOpen = await dialog.evaluate((d) => d.contains(document.activeElement));
      let escaped = 0;
      for (let n = 0; n < 25; n += 1) {
        await page.keyboard.press('Tab');
        if (!(await dialog.evaluate((d) => d.contains(document.activeElement)).catch(() => false))) escaped += 1;
      }
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      await page.screenshot({ path: join(OUT, 'overlays', `${label}-dark-1440.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      const back = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el && el !== document.body ? `${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40)}"` : '(body)';
      });
      results.push({ label, insideAtOpen, tabsThatLeft: escaped, focusAfterEscape: back, axe: violations.map((v) => v.id) });
    } catch (error) {
      results.push({ label, error: String(error).slice(0, 300) });
    }
  };
  await page.goto('/mix/current/edit'); await ready(page);
  await probe('export', async () => { await page.getByRole('button', { name: 'Download audio' }).focus(); await page.keyboard.press('Enter'); }, 'Save as an audio file');
  await page.goto('/mixes'); await ready(page);
  await probe('customize', async () => { await page.getByRole('button', { name: 'Customize' }).focus(); await page.keyboard.press('Enter'); }, 'Shape the next mix');
  await page.goto('/listen'); await ready(page);
  await probe('requests', async () => { await page.keyboard.press('r'); }, 'Requests');
  await page.goto('/library'); await ready(page);
  await probe('song-details', async () => { await page.getByRole('button', { name: /^Details for / }).first().focus(); await page.keyboard.press('Enter'); }, /.+/);
  await page.goto('/library'); await ready(page);
  await probe('palette', async () => { await page.keyboard.press('Control+k'); }, /.+/);
  // nested: palette over the requests drawer
  await page.goto('/listen'); await ready(page);
  try {
    await page.keyboard.press('r');
    await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible();
    await page.keyboard.press('Control+k');
    const top = await page.getByRole('dialog').count();
    await page.keyboard.press('Escape');
    const afterOne = await page.getByRole('dialog').count();
    await page.keyboard.press('Escape');
    const afterTwo = await page.getByRole('dialog').count();
    results.push({ label: 'nested requests+palette', dialogsOpen: top, afterOneEscape: afterOne, afterTwoEscapes: afterTwo });
  } catch (error) {
    results.push({ label: 'nested', error: String(error).slice(0, 300) });
  }
  save('overlays.json', results);
  await context.close();
});

test('phones: emulated iPhone and Pixel, touch targets, overflow, details sheet', async ({ browser }) => {
  const results: Record<string, unknown>[] = [];
  for (const [label, device] of [['iphone13', devices['iPhone 13']], ['pixel7', devices['Pixel 7']]] as const) {
    for (const theme of ['light', 'dark'] as const) {
      const { defaultBrowserType: _ignored, ...rest } = device;
      const context = await browser.newContext({ ...rest, colorScheme: theme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      for (const [name, address] of [['listen', '/listen'], ['library', '/library'], ['editor', '/mix/current/edit'], ['lucy', '/mixes/lucy'], ['mixes', '/mixes']] as const) {
        try {
          await page.goto(address);
          await ready(page);
          await page.screenshot({ path: join(OUT, 'phones', `${name}-${label}-${theme}.png`), animations: 'disabled' });
          const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role=button], input, select, [role=tab], [role=switch]'))
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && (r.width < 24 || r.height < 24); })
            .map((el) => { const r = el.getBoundingClientRect(); return `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
          const under44 = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role=button], [role=tab]'))
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).length);
          results.push({ label, theme, name, overflow: await overflow(page), under24: small, under44count: under44 });
        } catch (error) {
          results.push({ label, theme, name, error: String(error).slice(0, 300) });
        }
      }
      if (theme === 'light') {
        try {
          await page.goto('/library');
          await ready(page);
          const opener = page.getByRole('button', { name: /^Details for / }).first();
          await opener.tap();
          const sheet = page.getByRole('dialog').first();
          await expect(sheet).toBeVisible();
          await page.waitForTimeout(400);
          await page.screenshot({ path: join(OUT, 'phones', `library-sheet-${label}-light.png`), animations: 'disabled' });
          const buttons = await sheet.getByRole('button').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return `${el.textContent?.trim().slice(0, 20)} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} vh=${innerHeight}`; }));
          await page.keyboard.press('Escape');
          await expect(sheet).toBeHidden();
          const back = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? '(none)');
          results.push({ label, name: 'details-sheet', buttons, focusBack: back });
        } catch (error) {
          results.push({ label, name: 'details-sheet', error: String(error).slice(0, 300) });
        }
      }
      await context.close();
    }
  }
  save('phones.json', results);
});

test('400% zoom (320 CSS px at 4x), keyboard focus stays in view', async ({ browser }) => {
  const results: Record<string, unknown>[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 320, height: 225 }, deviceScaleFactor: 4, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const [name, address] of [['listen', '/listen'], ['library', '/library'], ['workshop', '/workshop'], ['editor', '/mix/current/edit'], ['mixes', '/mixes']] as const) {
      try {
        await page.goto(address);
        await ready(page);
        let hidden = 0;
        const hiddenNames: string[] = [];
        for (let n = 0; n < 20; n += 1) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(60);
          const seen = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return 'ok';
            const r = el.getBoundingClientRect();
            const covered = (() => { const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))); return top && !el.contains(top) && !top.contains(el); })();
            const off = r.bottom <= 0 || r.top >= innerHeight;
            return off || covered ? `${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)}${off ? ' offscreen' : ' covered'}` : 'ok';
          });
          if (seen !== 'ok') { hidden += 1; if (hiddenNames.length < 6) hiddenNames.push(seen); }
        }
        if (theme === 'light' || name === 'listen') await page.screenshot({ path: join(OUT, 'zoom', `${name}-${theme}-400.png`), animations: 'disabled' });
        results.push({ theme, name, overflow: await overflow(page), focusHiddenOrCovered: hidden, hiddenNames });
      } catch (error) {
        results.push({ theme, name, error: String(error).slice(0, 300) });
      }
    }
    await context.close();
  }
  save('zoom.json', results);
});

test('stress states: compact density, loading, server errors, network loss, RTL and fallback font', async ({ browser }) => {
  const notes: Record<string, unknown>[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const { context, page } = await shoot(browser, theme, 1440);
    await page.addInitScript(() => localStorage.setItem('selecta.prefs', JSON.stringify({ density: 'compact' })));
    for (const [name, address] of [['library', '/library'], ['editor', '/mix/current/edit'], ['my-mixes', '/mixes/mine']] as const) {
      await page.goto(address); await ready(page);
      await page.screenshot({ path: join(OUT, 'states', `${name}-compact-${theme}-1440.png`), fullPage: true, animations: 'disabled' });
    }
    await context.close();
    const second = await shoot(browser, theme, 768);
    const p = second.page;
    // loading: hold the library answer
    await p.route('**/api/library?**', async (route) => { await new Promise((r) => setTimeout(r, 6000)); await route.continue().catch(() => {}); });
    await p.goto('/library');
    await expect(p.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
    await p.waitForTimeout(700);
    await p.screenshot({ path: join(OUT, 'states', `library-loading-${theme}-768.png`), animations: 'disabled' });
    await p.unroute('**/api/library?**');
    // server error on the library list
    await p.route('**/api/library?**', (route) => route.fulfill({ status: 500, body: 'boom' }));
    await p.goto('/library'); await p.waitForTimeout(2500);
    await p.screenshot({ path: join(OUT, 'states', `library-error-${theme}-768.png`), animations: 'disabled' });
    notes.push({ theme, state: 'library-error', text: (await p.locator('main').innerText()).slice(0, 400) });
    await p.unroute('**/api/library?**');
    // network loss after load
    for (const [name, address] of [['listen', '/listen'], ['editor', '/mix/current/edit']] as const) {
      await p.goto(address); await ready(p);
      await p.route('**/api/**', (route) => route.abort('internetdisconnected'));
      await p.waitForTimeout(9000);
      await p.screenshot({ path: join(OUT, 'states', `${name}-offline-${theme}-768.png`), animations: 'disabled' });
      const status = await p.evaluate(() => Array.from(document.querySelectorAll('[role=status],[role=alert]')).map((el) => (el.textContent ?? '').trim()).filter(Boolean).slice(0, 5));
      notes.push({ theme, state: `${name}-offline`, status });
      await p.unroute('**/api/**');
    }
    await second.context.close();
  }
  // fallback font: block web fonts
  const { context, page } = await shoot(browser, 'light', 1440);
  await page.route(/\.(woff2?|ttf|otf)(\?.*)?$/, (route) => route.abort());
  await page.route('**/fonts.googleapis.com/**', (route) => route.abort());
  for (const [name, address] of [['library', '/library'], ['listen', '/listen'], ['editor', '/mix/current/edit']] as const) {
    await page.goto(address); await ready(page);
    notes.push({ state: `fallback-${name}`, fonts: await page.evaluate(() => Array.from(document.fonts).map((f) => `${f.family} ${f.status}`).slice(0, 8)) });
    await page.screenshot({ path: join(OUT, 'states', `${name}-fallbackfont-light-1440.png`), fullPage: true, animations: 'disabled' });
  }
  await context.close();
  save('states.json', notes);
});

test('privacy: diagnostics and status carry no local path; Lucy consent before sending', async ({ browser, request }) => {
  const found: Record<string, unknown> = {};
  const { context, page } = await shoot(browser, 'light', 1440);
  const bodies: string[] = [];
  page.on('response', async (response) => { if (response.url().includes('/api/')) bodies.push(`${response.url()}\n${await response.text().catch(() => '')}`); });
  await page.goto('/workshop/diagnostics'); await ready(page);
  await page.screenshot({ path: join(OUT, 'privacy', 'diagnostics-light-1440.png'), fullPage: true, animations: 'disabled' });
  const shown = await page.locator('main').innerText();
  found.diagnosticsText = shown.slice(0, 3000);
  found.diagnosticsPaths = (shown.match(/[A-Za-z]:\\[^\s"]+|\/(?:Users|home|tmp)\/[^\s"]+/g) ?? []).slice(0, 10);
  const outbound: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) outbound.push(r.url()); });
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  await page.goto('/mixes/lucy'); await ready(page);
  await page.screenshot({ path: join(OUT, 'privacy', 'lucy-light-1440.png'), fullPage: true, animations: 'disabled' });
  found.lucyText = (await page.locator('main').innerText()).slice(0, 2000);
  for (const [name, address] of [['library', '/library'], ['listen', '/listen'], ['workshop', '/workshop'], ['sources', '/workshop/sources']] as const) {
    await page.goto(address); await ready(page);
  }
  found.outbound = outbound;
  found.pathsInApiBodies = bodies.flatMap((b) => (b.match(/[A-Za-z]:\\\\[^"]+/g) ?? []).map((m) => `${b.split('\n')[0]} -> ${m.slice(0, 80)}`)).slice(0, 20);
  save('privacy.json', found);
  await context.close();
});

test('audio ownership while browsing: no unsolicited sound', async ({ page }) => {
  await spyOnAudio(page);
  for (const [, address] of ROUTES) { await page.goto(address); await ready(page); }
  save('audio.json', { soundsStartedWhileBrowsing: await soundsStarted(page) });
});
