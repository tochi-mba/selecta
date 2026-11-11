import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PAGES, resetMix, spyOnAudio } from './helpers';

/**
 * ADR-278 CSS ownership, in the browser. The static register (owners, repeated selectors, breakpoints and
 * review rules) is web/src/styles/mp-css-register.test.ts; this spec proves Library and Requests styling
 * stays in its own view (MP-0278-05) and that the CSS work left audio, API, data, routing and stored
 * preferences alone (MP-0278-07).
 */
// Playwright runs from web/ (the package is ESM, so there is no __dirname)
const SRC = join(process.cwd(), 'src');

/** Class names written in a view's className strings, static parts only. */
function classesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const words = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const word of words.split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(word)) found.add(word);
  }
  return found;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

/** Classes only Library.tsx (or only Requests.tsx) writes, which no other source file mentions. */
function ownedBy(view: 'Library' | 'Requests'): string[] {
  const own = join(SRC, 'views', `${view}.tsx`);
  const others = tsxFiles(SRC).filter((file) => file !== own).map((file) => readFileSync(file, 'utf8')).join('\n');
  return [...classesIn(readFileSync(own, 'utf8'))].filter((name) => !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(others)).sort();
}

/** Every style rule naming one of these classes, with what it matches and whether that is inside `inside`. */
function bleed({ names, inside }: { names: string[]; inside: string | null }) {
  const rules: { selector: string; matched: number; outside: string[] }[] = [];
  const visit = (list: CSSRuleList) => {
    for (const rule of [...list]) {
      if (rule instanceof CSSStyleRule) {
        // a grouped rule (".display, .song-open") is judged only by the selectors that name a view class
        const parts: string[] = [];
        let depth = 0;
        let part = '';
        for (const char of rule.selectorText) {
          if (char === ',' && depth === 0) { parts.push(part); part = ''; continue; }
          if (char === '(') depth += 1;
          if (char === ')') depth -= 1;
          part += char;
        }
        parts.push(part);
        const named = parts.map((item) => item.trim()).filter((item) => names.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(item)));
        if (!named.length) continue;
        let matches: Element[] = [];
        try { matches = [...document.querySelectorAll(named.join(', ').replace(/::?(before|after|placeholder|marker|-webkit-[\w-]+)/g, ''))]; } catch { continue; }
        const outside = matches.filter((element) => !inside || !element.closest(inside)).map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`);
        rules.push({ selector: rule.selectorText, matched: matches.length, outside });
      } else if ('cssRules' in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of [...document.styleSheets]) visit(sheet.cssRules);
  return rules;
}

async function open(page: Page, route: string, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0278-05 Library and Requests classes style nothing outside their own view', async ({ page }, info) => {
  const library = ownedBy('Library');
  const requests = ownedBy('Requests');
  expect(library.length, 'Library-only classes found').toBeGreaterThan(5);
  expect(requests.length, 'Requests-only classes found').toBeGreaterThan(3);
  const report: Record<string, unknown> = { library, requests };
  // on every other page, at a phone and a desk width, those rules match nothing at all
  for (const width of [375, 1280]) {
    for (const route of PAGES.filter((path) => path !== '/library')) {
      await open(page, route, width);
      for (const [view, names] of [['Library', library], ['Requests', requests]] as const) {
        const rules = await page.evaluate(bleed, { names, inside: null });
        expect(rules.length, `${view} rules exist in the stylesheet`).toBeGreaterThan(0);
        const hits = rules.filter((rule) => rule.matched > 0).map((rule) => `${rule.selector}: ${rule.outside.join(', ')}`);
        expect(hits, `${view} rules reach ${route} at ${width}px`).toEqual([]);
      }
    }
  }
  // on the Library itself they stay inside the page, and with Requests open over it, inside that panel
  await open(page, '/library');
  const inLibrary = await page.evaluate(bleed, { names: library, inside: 'main#main' });
  expect(inLibrary.some((rule) => rule.matched > 0), 'Library rules apply to the Library').toBe(true);
  expect(inLibrary.flatMap((rule) => rule.outside), 'Library rules reach the frame').toEqual([]);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Requests/ }).click();
  await expect(page.locator('.overlay-panel')).toBeVisible();
  const inRequests = await page.evaluate(bleed, { names: requests, inside: '.overlay' });
  expect(inRequests.some((rule) => rule.matched > 0), 'Requests rules apply to Requests').toBe(true);
  expect(inRequests.flatMap((rule) => rule.outside), 'Requests rules reach the page under the panel').toEqual([]);
  report.inLibrary = inLibrary.length;
  report.inRequests = inRequests.length;
  writeFileSync(info.outputPath('mp-0278-05-bleed.json'), JSON.stringify(report, null, 2));
});

test('MP-0278-07 audio, API, data, routing and stored preferences are what they were', async ({ page, request }) => {
  await spyOnAudio(page);
  // what the source says may be stored, and the preference fields it knows
  const sources = tsxFiles(SRC).concat(join(SRC, 'state', 'prefs.ts'), join(SRC, 'player.ts'), join(SRC, 'lib.ts')).map((file) => readFileSync(file, 'utf8')).join('\n')
    + readdirSync(join(SRC, 'state')).map((file) => readFileSync(join(SRC, 'state', file), 'utf8')).join('\n');
  // the oldest key ('selecta-now', the resume point in lib.ts) predates the dotted names
  const knownKeys = new Set([...sources.matchAll(/'(selecta[.-][\w.-]+)'/g)].map((match) => match[1]));
  const prefsSource = readFileSync(join(SRC, 'state', 'prefs.ts'), 'utf8');
  const prefFields = [...prefsSource.match(/DEFAULT_PREFS: Prefs = \{([^}]*)\}/)![1].matchAll(/(\w+):/g)].map((match) => match[1]).sort();

  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/') && (response.status() >= 500 || response.status() === 404 || response.status() === 405)) failures.push(`${response.status()} ${response.url()}`);
  });
  const before = (await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id);

  // start the music, then use the polished frame: every page, the rail, the theme and the density
  await page.goto('/listen');
  await page.locator('.now .transport .primary').click();
  await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
  const contexts = await page.evaluate(() => window.audioSpy.contexts.length);
  await page.locator('.nav-collapse').click();
  await page.locator('.nav-collapse').click();
  await page.locator('[title^="Theme:"]').first().click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  for (const route of PAGES) {
    // within the app, as a listener moves, so the music carries on
    await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, route);
    await expect(page.locator('main#main')).toBeVisible();
    await expect(page.locator('.crumbs [aria-current="page"]'), `${route} is a real page`).not.toHaveText('Not found');
  }
  expect(await page.evaluate(() => window.audioSpy.contexts.length), 'one audio owner').toBe(contexts);
  expect(failures, 'API calls the frame made that the server does not answer').toEqual([]);

  const stored = await page.evaluate(() => Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)])));
  for (const key of Object.keys(stored)) {
    expect([...knownKeys].some((known) => key === known || (known.endsWith('.') && key.startsWith(known)) || key.startsWith(`${known}.`)), `unexpected stored key ${key}`).toBe(true);
  }
  const prefs = JSON.parse(stored['selecta.prefs'] ?? '{}');
  expect(Object.keys(prefs).sort(), 'preference fields').toEqual(prefFields);
  expect(prefs.theme).toBe('dark');
  expect(prefs.railCollapsed).toBe(false);
  // and the current mix on the server is untouched by any of it
  const after = (await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id);
  expect(after).toEqual(before);
  await page.locator('[title^="Theme:"]').first().click();
  await page.getByRole('menuitemradio', { name: 'Match this computer' }).click();
});
