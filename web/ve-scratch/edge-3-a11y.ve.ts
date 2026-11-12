import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { out, ROUTES, save, setTheme, settle } from './lib';
import { writeFileSync } from 'node:fs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder.include(include);
  const { violations, incomplete } = await builder.analyze();
  return {
    violations: violations.flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact}): ${String(n.target)}`)),
    incomplete: incomplete.map((v) => `${v.id}: ${v.nodes.length}`),
  };
}

const outline = (page: Page) => page.evaluate(() => {
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((h) => (h as HTMLElement).offsetParent !== null || getComputedStyle(h).position === 'fixed')
    .map((h) => `${h.tagName} ${(h as HTMLElement).innerText.trim().replace(/\s+/g, ' ').slice(0, 70)}`);
  const landmarks = [...document.querySelectorAll('header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"], [role="region"], [role="search"], section[aria-label], section[aria-labelledby]')]
    .map((n) => `${n.getAttribute('role') ?? n.tagName.toLowerCase()} "${n.getAttribute('aria-label') ?? (n.getAttribute('aria-labelledby') ? document.getElementById(n.getAttribute('aria-labelledby')!)?.textContent?.trim() : '') ?? ''}"`);
  const live = [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')]
    .map((n) => `${n.getAttribute('role') ?? ''} ${n.getAttribute('aria-live') ?? ''} ${n.className}`.trim());
  const positiveTabindex = [...document.querySelectorAll('[tabindex]')].filter((n) => Number(n.getAttribute('tabindex')) > 0).length;
  return { title: document.title, lang: document.documentElement.lang, headings, landmarks, live, positiveTabindex };
});

async function tabWalk(page: Page, max = 70) {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.locator('body').focus().catch(() => undefined);
  const stops: { role: string; name: string; visible: boolean; ring: boolean; inView: boolean }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement | null;
      if (!node || node === document.body) return null;
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      const name = (node.getAttribute('aria-label') ?? node.innerText ?? (node as HTMLInputElement).placeholder ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
      const key = `${node.tagName}|${name}|${Math.round(box.top)}|${Math.round(box.left)}`;
      return { key, role: node.getAttribute('role') ?? node.tagName.toLowerCase(), name, visible: box.width > 0 && box.height > 0, ring, inView: box.bottom > 0 && box.top < innerHeight };
    });
    if (!stop) continue;
    if (seen.has(stop.key)) break;
    seen.add(stop.key);
    const { key: _key, ...rest } = stop;
    stops.push(rest);
  }
  return stops;
}

test('every route: axe, headings, landmarks, live regions, tab order and focus rings, accessibility snapshot', async ({ page }) => {
  const report: Record<string, unknown> = {};
  for (const theme of ['dark', 'light'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, theme);
    for (const route of ROUTES) {
      await page.goto(route.path);
      await settle(page);
      const entry: Record<string, unknown> = { axe: await axe(page) };
      if (theme === 'dark') {
        entry.outline = await outline(page);
        entry.tab = await tabWalk(page);
        writeFileSync(out('aria', `${route.id}.yml`), await page.locator('body').ariaSnapshot());
      }
      report[`${theme} ${route.path}`] = entry;
    }
  }
  save('a11y-routes.json', report);
});

test('keyboard patterns: tabs, menu, combobox, dialog, grid; live regions over time', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'dark');
  const r: Record<string, unknown> = {};
  const active = () => page.evaluate(() => {
    const n = document.activeElement as HTMLElement;
    return `${n.getAttribute('role') ?? n.tagName.toLowerCase()} "${(n.getAttribute('aria-label') ?? n.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)}" sel=${n.getAttribute('aria-selected')}`;
  });

  // tabs: the seam inspector
  await page.goto('/mix/current/edit');
  const change = page.getByRole('button', { name: 'Change', exact: true }).first();
  await change.click();
  const tabs = page.getByRole('tab');
  await tabs.first().focus();
  const tabSeq: string[] = [await active()];
  for (const key of ['ArrowRight', 'ArrowRight', 'End', 'Home', 'ArrowLeft']) { await page.keyboard.press(key); tabSeq.push(`${key} -> ${await active()}`); }
  r.tablist = { names: await tabs.allInnerTexts(), tabpanel: await page.getByRole('tabpanel').count(), seq: tabSeq };
  r.inspectorAxe = await axe(page, '.edit-inspector, .overlay-sheet');
  writeFileSync(out('aria', 'inspector.yml'), await page.locator('.edit-inspector, .overlay-sheet').first().ariaSnapshot());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  r.inspectorFocusReturn = await active();

  // menu: an editor row's More menu
  const more = page.getByRole('button', { name: /^More for / }).first();
  await more.focus();
  await page.keyboard.press('Enter');
  const menuSeq: string[] = [`open -> ${await active()}`];
  for (const key of ['ArrowDown', 'ArrowDown', 'End', 'Home', 'ArrowUp']) { await page.keyboard.press(key); menuSeq.push(`${key} -> ${await active()}`); }
  r.menuItems = await page.getByRole('menuitem').allInnerTexts();
  await page.keyboard.press('Escape');
  menuSeq.push(`Escape -> ${await active()}`);
  r.menu = menuSeq;

  // dialog: Download audio
  const download = page.getByRole('button', { name: 'Download audio' });
  await download.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Save as an audio file' });
  await expect(dialog).toBeVisible();
  const trapped: boolean[] = [];
  for (let i = 0; i < 25; i += 1) { await page.keyboard.press('Tab'); trapped.push(await dialog.evaluate((d) => d.contains(document.activeElement))); }
  r.dialog = { modal: await dialog.getAttribute('aria-modal'), tag: await dialog.evaluate((d) => d.tagName), trappedAll: trapped.every(Boolean), axe: await axe(page, '[role="dialog"], dialog') };
  writeFileSync(out('aria', 'export-dialog.yml'), await dialog.ariaSnapshot());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  r.dialogFocusReturn = await active();

  // combobox: the command palette
  await page.goto('/library');
  await settle(page);
  await page.keyboard.press('Control+k');
  const combo = page.getByRole('combobox').first();
  await expect(combo).toBeVisible();
  await combo.fill('lib');
  const comboSeq: string[] = [];
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp']) {
    await page.keyboard.press(key);
    comboSeq.push(`${key} -> focus ${await active()} activedescendant=${await combo.getAttribute('aria-activedescendant')} expanded=${await combo.getAttribute('aria-expanded')}`);
  }
  r.combobox = { controls: await combo.getAttribute('aria-controls'), listbox: await page.getByRole('listbox').count(), options: (await page.getByRole('option').allInnerTexts()).slice(0, 8), seq: comboSeq };
  writeFileSync(out('aria', 'palette.yml'), await page.getByRole('dialog').first().ariaSnapshot().catch(() => 'no dialog'));
  await page.keyboard.press('Escape');
  r.comboFocusReturn = await active();

  // grid: the Studio
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click().catch(() => undefined);
  const grid = page.getByRole('grid').first();
  r.gridTabStops = await grid.locator('[tabindex="0"]').count();
  r.gridName = await grid.getAttribute('aria-label');
  await grid.locator('[tabindex="0"]').first().focus();
  const gridSeq: string[] = [await active()];
  for (const key of ['ArrowRight', 'ArrowDown', 'End', 'Home', 'Space']) {
    await page.keyboard.press(key);
    gridSeq.push(`${key} -> ${await page.evaluate(() => { const n = document.activeElement as HTMLElement; return `${n.getAttribute('aria-label')} pressed=${n.getAttribute('aria-pressed')}`; })}`);
  }
  r.grid = gridSeq;
  writeFileSync(out('aria', 'studio.yml'), await page.locator('.edit-inspector, .overlay-sheet, .studio').first().ariaSnapshot());
  await page.keyboard.press('Space');

  // live regions while a render job runs and the mix plays: count changes in 20 seconds
  await page.goto('/listen');
  await page.evaluate(() => {
    (window as unknown as { liveLog: string[] }).liveLog = [];
    const log = (window as unknown as { liveLog: string[] }).liveLog;
    new MutationObserver((records) => {
      for (const record of records) {
        const region = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[aria-live], [role="status"], [role="alert"], [role="log"]');
        if (region && region.getAttribute('aria-live') !== 'off') log.push(`${Math.round(performance.now())} ${(region as HTMLElement).innerText.trim().slice(0, 80)}`);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const button = page.locator('.now .transport .primary');
  await button.click();
  await request.post('/api/mix/songs', { data: { song_id: 2 } });
  await request.post('/api/mix/render');
  await page.waitForTimeout(20_000);
  r.liveDuringPlayAndRender = await page.evaluate(() => (window as unknown as { liveLog: string[] }).liveLog);
  await button.click();
  save('a11y-patterns.json', r);
});

test('Lucy stream: live-region updates while a reply arrives', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'dark');
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'VE stream' } })).json();
  await page.goto(`/mixes/lucy/${made.id}`);
  await page.evaluate(() => {
    (window as unknown as { liveLog: string[] }).liveLog = [];
    const log = (window as unknown as { liveLog: string[] }).liveLog;
    new MutationObserver((records) => {
      for (const record of records) {
        const region = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[aria-live], [role="status"], [role="alert"], [role="log"]');
        if (region && region.getAttribute('aria-live') !== 'off') log.push(`${Math.round(performance.now())} [${region.getAttribute('aria-live') ?? region.getAttribute('role')}] ${(region as HTMLElement).innerText.trim().replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const prompt = page.getByRole('textbox', { name: 'Message to Lucy' });
  await prompt.fill('make me a long calm mix of 12 songs and explain every choice');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForTimeout(25_000);
  const result = {
    log: await page.evaluate(() => (window as unknown as { liveLog: string[] }).liveLog),
    regions: await page.evaluate(() => [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')].map((n) => `${n.getAttribute('role') ?? ''}/${n.getAttribute('aria-live') ?? ''}/${n.getAttribute('aria-busy') ?? ''} ${n.className}`)),
  };
  writeFileSync(out('aria', 'lucy.yml'), await page.locator('main#main').ariaSnapshot());
  save('a11y-lucy.json', result);
});

test('a large draft list with duplicate and long names; harmonic imagery', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'dark');
  const long = 'An extremely long draft name that keeps going well past any sensible width so it must wrap or truncate';
  for (let i = 0; i < 60; i += 1) {
    const name = i % 3 === 0 ? 'Friday night' : i % 3 === 1 ? `${long} ${i}` : `Draft ${i}`;
    await request.post('/api/drafts', { data: { name, copy_current: true } });
  }
  await page.goto('/mixes/mine');
  await settle(page);
  const r: Record<string, unknown> = { axe: await axe(page) };
  writeFileSync(out('aria', 'drafts-large.yml'), await page.locator('main#main').ariaSnapshot());
  r.buttonsNamed = await page.locator('main#main button').evaluateAll((nodes) => {
    const names = nodes.map((n) => (n.getAttribute('aria-label') ?? (n as HTMLElement).innerText).trim().replace(/\s+/g, ' '));
    const counts: Record<string, number> = {};
    for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
    return { total: names.length, duplicated: Object.entries(counts).filter(([, c]) => c > 1).slice(0, 30) };
  });
  r.tab = await tabWalk(page, 50);
  await page.screenshot({ path: out('drafts', 'drafts-large-dark.png'), fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: out('drafts', 'drafts-large-375-dark.png'), fullPage: false });
  save('a11y-drafts.json', r);

  await page.setViewportSize({ width: 1440, height: 900 });
  const imagery: Record<string, unknown> = {};
  for (const path of ['/discover', '/discover/harmonic']) {
    await page.goto(path);
    await settle(page);
    imagery[path] = {
      imgs: await page.locator('main#main [role="img"], main#main svg').evaluateAll((nodes) => nodes.slice(0, 20).map((n) => `${n.tagName} role=${n.getAttribute('role')} label=${n.getAttribute('aria-label')} hidden=${n.getAttribute('aria-hidden')}`)),
      axe: await axe(page),
      tab: await tabWalk(page, 30),
    };
    await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
    await page.screenshot({ path: out('imagery', `${path.replace(/\//g, '_')}-grayscale.png`) });
    writeFileSync(out('aria', `imagery${path.replace(/\//g, '_')}.yml`), await page.locator('main#main').ariaSnapshot());
  }
  save('a11y-imagery.json', imagery);
});
