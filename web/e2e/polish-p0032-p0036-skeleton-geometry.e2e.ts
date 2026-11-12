import { expect, test, type Page, type Route } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * UI/UX polish ADR-0036 P0032, P0034 and P0036: each placeholder takes the populated layout's place.
 * The answer is held by route until the placeholder has been measured, then released (or answered from
 * a fixture where the synthetic library has nothing to find), and the loaded layout is measured in the
 * same spot. P0033 (polish-p0033-library-skeleton-modes.e2e.ts) does the same for the Library.
 */

type Box = { left: number; top: number; width: number; height: number; bottom: number };
const ready = { status: 'ready', key: 'p0036', label: 'Word blend', style: 'word_blend', passed: true };
const link = (a: number, b: number) => ({ phrase: 'all night', kind: 'end-start', a, b, artist_a: 'Ada Reyes', title_a: `Song ${a}`, artist_b: 'Bo Lindqvist', title_b: `Song ${b}`, line_a: 'we danced all night', line_b: 'all night we sang', moves: ['word_blend', 'word_cut'], move: 'word_blend', state: { ...ready, key: `p0036-${a}-${b}` }, worked: true });
const pair = { id: 7, song_a: 3, song_b: 4, title_a: 'Paper Moon', title_b: 'Glass Harbour', artist_a: 'Ada Reyes', artist_b: 'Bo Lindqvist', status: 'new', payload: { a_at: 10, b_at: 20, bars: 4, transpose: 0 } };

/** Holds matching requests until released; a fixture answers them on release when given. */
async function hold(page: Page, pattern: string | RegExp, json?: unknown) {
  const held: Route[] = [];
  let open = false;
  const answer = (route: Route) => (json === undefined ? route.fallback() : route.fulfill({ json }));
  await page.route(pattern, (route) => (open ? answer(route) : void held.push(route)));
  return async () => { open = true; for (const route of held.splice(0)) await answer(route); };
}

const boxes = (page: Page, selector: string) => page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel)]
  .filter((node) => node.getClientRects().length > 0)
  .map((node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top + scrollY, width: rect.width, height: rect.height, bottom: rect.bottom + scrollY }; }), selector) as Promise<Box[]>;
const tracks = (page: Page, selector: string) => page.locator(selector).first().evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').filter(Boolean).length);
const near = (actual: number, expected: number, within: number, what: string) => expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(within);
const ratio = (actual: number, expected: number, low: number, high: number, what: string) => {
  expect(actual / expected, `${what}: ${actual} vs ${expected}`).toBeGreaterThan(low);
  expect(actual / expected, `${what}: ${actual} vs ${expected}`).toBeLessThan(high);
};

async function shapesOnly(page: Page, label: string) {
  const skeleton = page.locator(`main .skeleton[aria-label="${label}"]`);
  await expect(skeleton).toHaveAttribute('data-revealed', 'true');
  const content = skeleton.locator('.skeleton-content');
  await expect(content).toHaveAttribute('aria-hidden', 'true');
  expect((await content.innerText()).trim(), `${label}: shapes only`).toBe('');
  return skeleton;
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Other E2E tests change global flags; use the same baseline on every run.
  await request.post('/api/test/flags', { data: { flags: '' } });
  await resetMix(request);
});

test('P0032 the Mix feeling cards placeholder matches the loaded cards’ tracks, size and actions', async ({ page }) => {
  for (const width of [375, 768, 1440]) {
    const at = `${width}px`;
    await page.setViewportSize({ width, height: 900 });
    const release = await hold(page, /\/api\/vibes$/);
    await page.goto('/mixes');
    const skeleton = await shapesOnly(page, 'Finding compatible mix candidates');
    const heading = page.locator('.vibe-browser-head .section-title');
    const before = { heading: (await boxes(page, '.vibe-browser-head .section-title'))[0], columns: await tracks(page, 'main .skeleton-vibes .skeleton-content') };
    const unit = (await boxes(page, 'main .skeleton-vibes .skeleton-vibe'))[0];
    const actions = await boxes(page, 'main .skeleton-vibes .skeleton-vibe:first-child .skeleton-action');
    const motif = (await boxes(page, 'main .skeleton-vibes .skeleton-vibe:first-child .skeleton-motif'))[0];
    await release();
    await page.unroute(/\/api\/vibes$/);
    await expect(page.locator('.vibe-card').first()).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    const card = (await boxes(page, '.vibe-card'))[0];
    const play = await boxes(page, '.vibe-card:first-child .card-actions > :is(.primary, .quiet:not(.save-draft))');
    const realMotif = (await boxes(page, '.vibe-card:first-child .vibe-motif'))[0];
    await expect(heading).toBeVisible();

    expect(before.columns, `${at}: card columns`).toBe(await tracks(page, '.vibe-group .cards'));
    near(unit.left, card.left, 2, `${at}: card left`);
    near(unit.width, card.width, 2, `${at}: card width`);
    near(unit.top, card.top, 16, `${at}: card top`);
    ratio(unit.height, card.height, width <= 620 ? 0.7 : 0.9, width <= 620 ? 1.43 : 1.11, `${at}: card height`);
    near(motif.height, realMotif.height, 2, `${at}: motif height`);
    // reserved action geometry: two side by side, the real buttons' height, at the same distance from the foot
    expect(actions.length, `${at}: two actions`).toBe(2);
    expect(actions[1].left, `${at}: actions side by side`).toBeGreaterThan(actions[0].left);
    near(actions[0].top, actions[1].top, 0.5, `${at}: actions on one line`);
    near(actions[0].height, play[0].height, 2, `${at}: action height`);
    near(actions[0].width, play[0].width, 2, `${at}: action width`);
    near(unit.bottom - actions[0].bottom, card.bottom - play[0].bottom, 16, `${at}: actions from the foot`);
    // the heading above the cards does not move when they arrive
    near((await boxes(page, '.vibe-browser-head .section-title'))[0].top, before.heading.top, 0.5, `${at}: heading moved`);
  }
});

test('P0034 the Listen placeholders hold the waveform and lyrics places with no audio shape', async ({ page }) => {
  for (const width of [375, 1440]) {
    const at = `${width}px`;
    await page.setViewportSize({ width, height: 900 });
    const release = await hold(page, /\/api\/songs\/\d+$/);
    await page.goto('/listen');
    await shapesOnly(page, 'Loading this song');
    const strip = page.locator('main .skeleton-strip');
    await expect(strip).toHaveAttribute('data-revealed', 'true');
    // the waveform's place is one flat block: no children, no drawing, no image, hidden from assistive tech
    const flat = await strip.evaluate((node) => ({ children: node.childElementCount, image: getComputedStyle(node).backgroundImage, mask: getComputedStyle(node).maskImage, hidden: node.getAttribute('aria-hidden') }));
    expect(flat, `${at}: flat block`).toEqual({ children: 0, image: 'none', mask: 'none', hidden: 'true' });
    expect(await page.locator('main [role="status"][aria-label="Loading this song"]').count(), `${at}: one announcement`).toBe(1);
    const placeholder = { strip: (await boxes(page, 'main .skeleton-strip'))[0], lyrics: (await boxes(page, 'main .skeleton-listen'))[0], title: (await boxes(page, '.listen-identity'))[0] };
    await release();
    await page.unroute(/\/api\/songs\/\d+$/);
    await expect(page.locator('main .strip')).toBeVisible();
    await expect(page.locator('main .skeleton-strip, main .skeleton-listen')).toHaveCount(0);
    const loaded = { strip: (await boxes(page, 'main .strip'))[0], lyrics: (await boxes(page, 'main .lyrics'))[0], title: (await boxes(page, '.listen-identity'))[0] };

    near(placeholder.strip.left, loaded.strip.left, 1, `${at}: waveform left`);
    near(placeholder.strip.width, loaded.strip.width, 1, `${at}: waveform width`);
    near(placeholder.strip.top, loaded.strip.top, 2, `${at}: waveform top`);
    near(placeholder.strip.height, loaded.strip.height, 1, `${at}: waveform height`);
    near(placeholder.lyrics.left, loaded.lyrics.left, 1, `${at}: lyrics left`);
    near(placeholder.lyrics.width, loaded.lyrics.width, 1, `${at}: lyrics width`);
    near(placeholder.lyrics.top, loaded.lyrics.top, 2, `${at}: lyrics top`);
    ratio(placeholder.lyrics.height, loaded.lyrics.height, 0.75, 1.33, `${at}: lyrics height`);
    // the real title above stays where it was
    near(loaded.title.top, placeholder.title.top, 0.5, `${at}: title moved`);
  }
});

test('P0036 Discover pair placeholders take the cards’ place, with the chord matches heading real', async ({ page }) => {
  for (const width of [375, 1440]) {
    const at = `${width}px`;
    await page.setViewportSize({ width, height: 900 });
    // word connections: the search and its words are real, the cards are placeholders on .link-grid's tracks
    let release = await hold(page, '**/api/links?**', { links: [link(1, 2), link(3, 4), link(5, 6)], prepared: 3, preparing: 3 });
    await page.goto('/discover');
    let skeleton = await shapesOnly(page, 'Searching your lyrics');
    const search = (await boxes(page, 'main input[type="search"]'))[0];
    const columns = await tracks(page, 'main .skeleton-pairs .skeleton-content');
    const unit = (await boxes(page, 'main .skeleton-pairs .skeleton-unit'))[0];
    await release();
    await page.unroute('**/api/links?**');
    await expect(page.locator('.link-grid > .link-card').first()).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    const card = (await boxes(page, '.link-grid > .link-card'))[0];
    // an optional connection map can open above the cards; the placeholder holds the place it starts in
    const map = (await boxes(page, 'main .relationship-map'))[0];
    expect(columns, `${at}: word card columns`).toBe(await tracks(page, '.link-grid'));
    near(unit.left, card.left, 2, `${at}: word card left`);
    near(unit.width, card.width, 2, `${at}: word card width`);
    near(unit.top, map ? map.top : card.top, 16, `${at}: word card top`);
    ratio(unit.height, card.height, 0.75, 1.33, `${at}: word card height`);
    near((await boxes(page, 'main input[type="search"]'))[0].top, search.top, 0.5, `${at}: search moved`);

    // chord matches: the section heading and its explanation are real while the one pair loads
    release = await hold(page, '**/api/discoveries', [pair]);
    await page.goto('/discover/harmonic');
    skeleton = await shapesOnly(page, 'Finding harmonic discoveries');
    await expect(page.locator('main .discoveries h2')).toHaveText('Songs that might share chords');
    await expect(page.locator('main .discoveries > .hint').first()).toContainText('Selecta plays you the chords it heard');
    const head = (await boxes(page, 'main .discoveries h2'))[0];
    const pending = (await boxes(page, 'main .discoveries .skeleton-unit'))[0];
    await release();
    await page.unroute('**/api/discoveries');
    await expect(page.locator('main .discovery')).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    const real = (await boxes(page, 'main .discovery'))[0];
    near((await boxes(page, 'main .discoveries h2'))[0].top, head.top, 0.5, `${at}: chord heading moved`);
    near(pending.left, real.left, 2, `${at}: pair left`);
    near(pending.width, real.width, 2, `${at}: pair width`);
    near(pending.top, real.top, 16, `${at}: pair top`);
    ratio(pending.height, real.height, 0.6, 1.67, `${at}: pair height`);
  }
});

test('P0036 Workshop information placeholders are rows under the real panel headings', async ({ page }) => {
  for (const width of [375, 1440]) {
    const at = `${width}px`;
    await page.setViewportSize({ width, height: 900 });
    const release = await hold(page, /\/api\/jobs$/);
    await page.goto('/workshop');
    const skeleton = await shapesOnly(page, 'Finding out what’s running');
    const panel = page.locator('main section.panel:has(.skeleton[aria-label="Finding out what’s running"])');
    await expect(panel.locator('h2')).toHaveText('What’s happening now');
    const rows = await boxes(page, 'main .skeleton[aria-label="Finding out what’s running"] .skeleton-row');
    await release();
    await page.unroute(/\/api\/jobs$/);
    await expect(page.locator('main .job-list > li').first()).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    const items = await boxes(page, 'main .job-list > li');
    expect(rows.length, `${at}: one placeholder row per job row`).toBe(items.length);
    near(rows[0].left, items[0].left, 1, `${at}: row left`);
    near(rows[0].width, items[0].width, 1, `${at}: row width`);
    near(rows[0].top, items[0].top, 16, `${at}: first row top`);
    const span = (list: Box[]) => list[list.length - 1].bottom - list[0].top;
    ratio(span(rows), span(items), 0.6, 1.67, `${at}: list height`);

    const diagnostics = await hold(page, /\/api\/diagnostics$/);
    await page.goto('/workshop/diagnostics');
    await shapesOnly(page, 'Gathering details');
    await expect(page.locator('main section.panel:has(.skeleton[aria-label="Gathering details"]) h2')).toHaveText('Diagnostics');
    const heading = (await boxes(page, 'main section.panel:has(.skeleton[aria-label="Gathering details"]) h2'))[0];
    const shape = (await boxes(page, 'main .skeleton[aria-label="Gathering details"]'))[0];
    await diagnostics();
    await page.unroute(/\/api\/diagnostics$/);
    await expect(page.locator('main .diagnostic-facts')).toBeVisible();
    const facts = (await boxes(page, 'main .diagnostic-facts'))[0];
    near((await boxes(page, 'main section.panel:has(.diagnostic-facts) h2'))[0].top, heading.top, 0.5, `${at}: diagnostics heading moved`);
    near(shape.left, facts.left, 1, `${at}: diagnostics left`);
    near(shape.width, facts.width, 1, `${at}: diagnostics width`);
  }
});
