import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FLAG_IDS, REGISTRY, type FlagId } from '../src/flags';
import { resetMix, stickingOut } from './helpers';
import { layoutProblems } from './layout';

/** Every feature, turned off, and every page it shows up on, checked for what's left behind. Each
 * page must still fit the window, pass the automatic accessibility checks, link to nothing that's
 * gone, say nothing about what's gone, ask the server nothing about it, and close up around the gap.
 * Screenshots go to test-results/flags as review candidates, not approved baselines. */

const SHOTS = 'test-results/flags';
const WIDTHS = [[375, 812], [1280, 900]] as const;

/** Where each surface is, and how to open it if it's an overlay. An opener that finds nothing to press
 * is fine: the feature it needs is off, so the page is checked without it. */
const SURFACES: Record<string, { at: string; open?: (page: Page) => Promise<void> }> = {
  listen: { at: '/listen' },
  stage: { at: '/listen' },
  mixes: { at: '/mixes' },
  mine: { at: '/mixes/mine' },
  edit: { at: '/mix/current/edit' },
  library: { at: '/library' },
  'discover.words': { at: '/discover' },
  'discover.harmonic': { at: '/discover/harmonic' },
  lucy: { at: '/mixes/lucy' },
  listening: { at: '/listening' },
  workshop: { at: '/workshop' },
  'workshop.analysis': { at: '/workshop/analysis' },
  'workshop.sources': { at: '/workshop/sources' },
  'workshop.storage': { at: '/workshop/storage' },
  'workshop.learning': { at: '/workshop/learning' },
  'workshop.diagnostics': { at: '/workshop/diagnostics' },
  'overlay.requests': { at: '/listen', open: (page) => press(page, /^Requests/) },
  'overlay.palette': { at: '/mixes', open: (page) => press(page, 'Search and commands') },
  'overlay.help': { at: '/mixes', open: (page) => press(page, 'Keyboard shortcuts') },
  'overlay.activity': { at: '/mixes', open: (page) => press(page, /^Activity/) },
  'overlay.glossary': { at: '/mixes', open: async (page) => { await press(page, 'Keyboard shortcuts'); await press(page, 'Music terms'); } },
  'overlay.inspector': { at: '/mix/current/edit', open: (page) => press(page, 'Change') },
  'overlay.studio': { at: '/mix/current/edit', open: async (page) => { await press(page, 'Change'); await press(page, 'Studio', 'tab'); } },
  'overlay.export': { at: '/mix/current/edit', open: (page) => press(page, 'Download audio') },
  'overlay.shaping': { at: '/mixes', open: (page) => press(page, 'Customize') },
  'overlay.song_details': { at: '/library', open: (page) => press(page, /^Details for/) },
};

async function press(page: Page, name: string | RegExp, role: 'button' | 'tab' = 'button') {
  const control = page.getByRole(role, { name, exact: typeof name === 'string' }).first();
  if (await control.isVisible().catch(() => false)) {
    await control.click();
    await page.waitForTimeout(250);
  }
}

/** The pages a build without these flags doesn't have, so nothing may link to them. */
function offPages(on: (id: FlagId) => boolean): string[] {
  const pages: [string, boolean][] = [
    ['/mixes/lucy', on('lucy')],
    ['/discover/harmonic', on('discover.harmonic')],
    ['/listening', on('listening_study')],
    ['/mix/current/edit', on('editor')],
    ['/workshop/sources', on('library.folders')],
    ['/workshop/diagnostics', on('workspace.diagnostics')],
    ['/workshop/storage', on('workspace.storage') || on('workspace.backup')],
    ['/workshop/learning', on('learning.memory') || on('listening_study')],
  ];
  const off = pages.filter(([, there]) => !there).map(([path]) => path);
  if (!on('discover.word_links')) off.push('/discover');
  if (!on('editor') || !on('drafts')) off.push('/mixes/drafts/');
  return off;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A route template such as "GET /api/songs/{id}/audio": every literal character matches
// itself, and each {placeholder} matches one path segment.
const asPattern = (route: string) => {
  const [method, template] = route.split(' ');
  const literal = template.split(/\{[^}]+\}/).map(escapeRegExp).join('[^/]+');
  return { method, path: new RegExp(`^${literal}$`) };
};

async function useFlags(request: APIRequestContext, flags: string): Promise<(id: FlagId) => boolean> {
  const answer = await request.post('/api/test/flags', { data: { flags } });
  expect(answer.ok()).toBe(true);
  const state = (await answer.json()) as Record<string, boolean>;
  return (id) => state[id] !== false;
}

type Seen = { requests: { method: string; path: string }[]; errors: string[] };

function watch(page: Page): Seen {
  const seen: Seen = { requests: [], errors: [] };
  page.on('request', (asked) => {
    const url = new URL(asked.url());
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/test/')) seen.requests.push({ method: asked.method(), path: url.pathname });
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('turned off in this build')) seen.errors.push(message.text());
  });
  return seen;
}

/** Everything wrong with the page as it is now, for a build with these flags. */
async function problems(page: Page, where: string, on: (id: FlagId) => boolean): Promise<string[]> {
  const found = [...(await stickingOut(page, where)), ...(await layoutProblems(page, where))];
  const gone = offPages(on);
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? ''));
  for (const href of links) {
    if (gone.some((path) => href === path || href.startsWith(`${path}?`) || (path.endsWith('/') && href.startsWith(path)))) found.push(`${where}: links to ${href}, which is off`);
  }
  const text = await page.locator('body').innerText();
  for (const id of FLAG_IDS) {
    if (on(id)) continue;
    for (const words of REGISTRY[id].words ?? []) {
      if (text.includes(words)) found.push(`${where}: says “${words}”, but ${id} is off`);
    }
  }
  return found;
}

function offRoutes(on: (id: FlagId) => boolean) {
  return FLAG_IDS.filter((id) => !on(id)).flatMap((id) => (REGISTRY[id].routes ?? []).map((route) => ({ id, ...asPattern(route) })));
}

async function sweep(page: Page, request: APIRequestContext, flags: string, surfaces: string[], options: { shots?: string; axe?: boolean } = {}) {
  const on = await useFlags(request, flags);
  const seen = watch(page);
  const found: string[] = [];
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    for (const surface of surfaces) {
      const { at, open } = SURFACES[surface];
      await page.goto(at);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await page.waitForTimeout(300);
      if (open) await open(page);
      const where = `${flags || 'all on'} · ${surface} at ${width}px`;
      found.push(...(await problems(page, where, on)));
      if (options.axe) {
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        for (const problem of violations) found.push(`${where}: ${problem.id} at ${problem.nodes.map((node) => String(node.target)).join(', ')}`);
      }
      if (options.shots) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/${options.shots}-${surface}-${width}.png`, fullPage: true });
      }
    }
  }
  for (const asked of seen.requests) {
    const off = offRoutes(on).find((route) => route.method === asked.method && route.path.test(asked.path));
    if (off) found.push(`${flags}: asked the server ${asked.method} ${asked.path}, but ${off.id} is off`);
  }
  found.push(...seen.errors.map((error) => `${flags}: ${error}`));
  return [...new Set(found)];
}

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test.afterEach(async ({ request }) => {
  await useFlags(request, '');
});

const EVERYWHERE = Object.keys(SURFACES);

for (const colorScheme of ['light', 'dark'] as const) {
  test(`with everything that isn't core turned off, every page still holds together in ${colorScheme}`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    expect(await sweep(page, request, 'minimal', EVERYWHERE, { shots: `minimal-${colorScheme}`, axe: true })).toEqual([]);
  });
}

const AREAS = [...new Set(FLAG_IDS.map((id) => REGISTRY[id].area))].filter((area) => area !== 'Core');
for (const area of AREAS) {
  test(`with all of ${area} turned off, every page still holds together`, async ({ page, request }) => {
    const off = FLAG_IDS.filter((id) => REGISTRY[id].area === area && !REGISTRY[id].core).map((id) => `-${id}`).join(' ');
    const slug = area.toLowerCase().replace(/[^a-z]+/g, '-');
    expect(await sweep(page, request, off, EVERYWHERE, { shots: `area-${slug}` })).toEqual([]);
  });
}

// The local site's surfaces only: `cloud.*` ones are the Cloud site's, swept by e2e-cloud/flags.cloud.ts.
const localSurfaces = (id: FlagId) => (REGISTRY[id].surfaces ?? []).filter((surface) => surface in SURFACES);
for (const id of FLAG_IDS.filter((flag) => !REGISTRY[flag].core && localSurfaces(flag).length)) {
  test(`with ${id} turned off, the pages it was on still hold together`, async ({ page, request }) => {
    expect(await sweep(page, request, `-${id}`, localSurfaces(id))).toEqual([]);
  });
}
