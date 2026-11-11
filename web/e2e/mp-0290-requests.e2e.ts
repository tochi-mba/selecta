import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * ADR-0290 Requests drawer: fit, result density with long titles, distinguishable stages, the bridge route
 * and the consequence of each consent action, cancellation against late answers, and the drawer's actions
 * staying clear of the player and toasts. The request list is served from fixtures here so every stage is
 * on screen at once; the mix itself is real and playing (stages only exist while it plays).
 * Candidates for an independent reviewer; a real phone keyboard and requester comprehension need a person.
 */
type Song = { id: number; title: string; artist: string };
const LONG = 'A Request With A Title So Long It Has To Wrap Somewhere Sensible On A Phone';

async function songs(request: APIRequestContext): Promise<Song[]> {
  const all = (await (await request.get('/api/songs?q=&state=all&limit=40')).json()) as Song[];
  return all.filter((song) => song.title && song.artist).sort((one, other) => one.id - other.id);
}

function rowsFor(all: Song[]) {
  const [first, , , , a, b, c, d, e, f] = all;
  const route = [{ id: b.id, title: b.title, artist: b.artist }, { id: a.id, title: a.title, artist: a.artist }];
  return [
    { id: 901, song_id: a.id, title: a.title, artist: a.artist, status: 'pending', available: 1, stage: 'approve', needs_approval: true, bridge_choice: null, after: first.title, after_id: first.id, route, transitions: [{ from: first.title, to: b.title, key: 'x1', status: 'waiting' }, { from: b.title, to: a.title, key: 'x2', status: 'waiting' }] },
    { id: 902, song_id: c.id, title: LONG, artist: c.artist, status: 'pending', available: 1, stage: 'searching' },
    { id: 903, song_id: d.id, title: d.title, artist: d.artist, status: 'pending', available: 1, stage: 'waiting' },
    { id: 904, song_id: e.id, title: e.title, artist: e.artist, status: 'pending', available: 1, stage: 'preparing', after: first.title, after_id: first.id, seconds: 40 },
    { id: 905, song_id: f.id, title: f.title, artist: f.artist, status: 'pending', available: 1, stage: 'ready', after: first.title, after_id: first.id },
  ];
}

/** The mix playing, the request list served from `rows`, and the drawer open. */
async function openDrawer(page: Page, rows: unknown[], width = 1440, height = 900) {
  await page.route('**/api/requests', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { requests: rows } }) : route.fallback()));
  // the look for a spot answers with the list too, so it comes from the same fixtures
  await page.route('**/api/requests/consider', (route) => route.fulfill({ json: { requests: rows } }));
  await page.setViewportSize({ width, height });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('button', { name: /^Requests/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await expect(drawer).toBeVisible();
  return drawer;
}

const rect = (locator: Locator) => locator.evaluate((element) => {
  const box = element.getBoundingClientRect();
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
});

const unobscured = (locator: Locator) => locator.evaluate((element) => {
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!hit && (hit === element || element.contains(hit));
});

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3, 4]);
});

test('MP-0290-01 title, search, close and the request list fit phone and desktop widths', async ({ page, request }) => {
  const rows = rowsFor(await songs(request));
  for (const [width, height] of [[320, 640], [375, 812], [768, 1024], [1440, 900]] as const) {
    const drawer = await openDrawer(page, rows, width, height);
    const panel = await rect(drawer);
    expect(panel.left).toBeGreaterThanOrEqual(-1);
    expect(panel.right).toBeLessThanOrEqual(width + 1);
    const close = drawer.getByRole('button', { name: 'Close Requests', exact: true });
    const title = drawer.locator('.overlay-head h2, .overlay-title, h2').first();
    const search = drawer.getByRole('combobox', { name: 'Request a song' });
    for (const [name, part] of [['title', title], ['close', close], ['search', search], ['list', drawer.locator('.request-list')]] as const) {
      await part.scrollIntoViewIfNeeded();
      const box = await rect(part);
      expect(box.left, `${width}px: ${name} starts outside the drawer`).toBeGreaterThanOrEqual(panel.left - 1);
      expect(box.right, `${width}px: ${name} runs past the drawer`).toBeLessThanOrEqual(panel.right + 1);
    }
    const closeBox = await rect(close);
    expect(Math.min(closeBox.width, closeBox.height), `${width}px: Close is under 44px`).toBeGreaterThanOrEqual(44);
    // the search uses the drawer's width, less its padding, at every size
    const field = await rect(search);
    expect(field.width, `${width}px: the search is cramped`).toBeGreaterThanOrEqual(Math.min(panel.width - 96, 220));
    expect(await drawer.evaluate((element) => element.scrollWidth - element.clientWidth), `${width}px: the drawer scrolls sideways`).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
  }
});

test('MP-0290-02 song, availability, reason and Ask stay readable with long titles', async ({ page, request }) => {
  const all = await songs(request);
  const found = all.slice(0, 6).map((song, index) => ({ ...song, title: index % 2 ? `${LONG} ${index}` : song.title, artist: index === 3 ? 'An Artist Name That Is Also Far Longer Than Usual' : song.artist }));
  await page.route('**/api/songs?q=*', (route) => route.fulfill({ json: found }));
  for (const width of [320, 1440]) {
    const drawer = await openDrawer(page, [], width, 800);
    await drawer.getByRole('combobox', { name: 'Request a song' }).fill('a');
    const options = drawer.getByRole('option');
    await expect(options).toHaveCount(6);
    const readings = await options.locator('button').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const name = button.querySelector('.request-name b')!;
      const artist = button.querySelector('.request-name span')!;
      const ask = button.querySelector('small')!;
      const askBox = ask.getBoundingClientRect();
      const nameBox = name.getBoundingClientRect();
      return {
        label: button.getAttribute('aria-label'),
        ask: ask.textContent?.trim(),
        nameCut: name.scrollWidth > name.clientWidth + 1,
        artistCut: artist.scrollWidth > artist.clientWidth + 1,
        overlap: nameBox.right - askBox.left,
        askInside: askBox.right <= box.right + 1,
        height: box.height,
        nameSize: parseFloat(getComputedStyle(name).fontSize),
      };
    }));
    for (const reading of readings) {
      expect(reading.nameCut, `${width}px: a long title is cut off in "${reading.label}"`).toBe(false);
      expect(reading.artistCut, `${width}px: an artist is cut off in "${reading.label}"`).toBe(false);
      expect(reading.overlap, `${width}px: the title runs into Request`).toBeLessThanOrEqual(0);
      expect(reading.askInside).toBe(true);
      expect(reading.height).toBeGreaterThanOrEqual(44);
      expect(reading.nameSize).toBeGreaterThanOrEqual(14);
      expect(reading.ask).toMatch(/^(Request|Requested|In your mix|Coming as a bridge)$/);
    }
    // what is already in the mix says so, and cannot be asked for twice
    await expect(options.first().locator('button')).toBeDisabled();
    await expect(options.first().locator('small')).toHaveText('In your mix');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
});

test('MP-0290-03 searching, waiting, approval, preparing and ready each look and read differently', async ({ page, request }) => {
  const drawer = await openDrawer(page, rowsFor(await songs(request)), 1440, 1000);
  const stages = await drawer.locator('.request-row').evaluateAll((rows) => rows.map((row) => {
    const pill = row.querySelector('.pill')!;
    const style = getComputedStyle(row);
    return { stage: row.getAttribute('data-stage'), label: pill.textContent, tone: row.className.replace('request-row', '').trim(), marker: style.boxShadow, pillColor: getComputedStyle(pill).color, pillBorder: getComputedStyle(pill).borderColor };
  }));
  expect(stages.map((stage) => stage.stage).sort()).toEqual(['approve', 'preparing', 'ready', 'searching', 'waiting']);
  const labels = new Set(stages.map((stage) => stage.label));
  expect(labels.size, 'two stages share the same words').toBe(5);
  expect(Object.fromEntries(stages.map((stage) => [stage.stage, stage.label]))).toEqual({
    approve: 'Needs your choice', searching: 'Finding a place', waiting: 'Requested · waiting', preparing: 'Getting ready', ready: 'Ready for an opening',
  });
  // the groups put what needs you first, then what is closest, each with its heading
  await expect(drawer.locator('.request-group h3')).toHaveText(['Needs your choice', 'Coming up', 'Preparing', 'Waiting']);
  // a stage that needs you is marked differently from one that is quietly waiting, without relying on words alone
  const byStage = Object.fromEntries(stages.map((stage) => [stage.stage, stage]));
  expect(byStage.approve.marker).not.toBe(byStage.waiting.marker);
  expect(byStage.preparing.marker).not.toBe(byStage.waiting.marker);
  await expect(drawer.locator('.request-row[data-stage="preparing"] .pill')).toHaveClass(/working/);
  await expect(drawer.locator('.request-row[data-stage="waiting"] .pill')).not.toHaveClass(/working/);
});

test('MP-0290-04 the extra songs and their order are spelled out before consent', async ({ page, request }) => {
  const all = await songs(request);
  const rows = rowsFor(all);
  const drawer = await openDrawer(page, rows, 375, 812);
  const approve = drawer.getByRole('group', { name: `Approve the route to ${all[4].title}` });
  await expect(approve).toBeVisible();
  const route = approve.getByRole('list', { name: `Proposed route to ${all[4].title}` });
  await expect(route.locator('li > span')).toHaveText([all[5].title, all[4].title]);
  await expect(route.locator('li small')).toHaveText([`Extra song, ${all[5].artist}`, 'Your request']);
  await expect(approve).toContainText('These 2 songs join together once every transition is ready, or none of them do');
  // the transitions in playing order, each one to hear before saying yes
  await expect(approve.locator('.request-pair')).toHaveText([`${all[0].title} → ${all[5].title}`, `${all[5].title} → ${all[4].title}`]);
  // the route reads top to bottom in playing order, and sits above the buttons that agree to it
  const tops = await route.locator('li').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  expect(tops[0]).toBeLessThan(tops[1]);
  const routeBox = await rect(route);
  const yes = await rect(approve.getByRole('button', { name: 'Add both' }));
  expect(routeBox.bottom).toBeLessThanOrEqual(yes.top);
});

test('MP-0290-05 Use this, Don’t use a bridge and Add to mix anyway each say what they will do', async ({ page, request }) => {
  const all = await songs(request);
  const rows = rowsFor(all);
  const [first] = all;
  const bridge = all[7];
  (rows[3] as Record<string, unknown>).bridge_choice = true;
  (rows[3] as Record<string, unknown>).stage = 'approve';
  (rows[3] as Record<string, unknown>).route = [{ id: bridge.id, title: bridge.title, artist: bridge.artist }, { id: rows[3].song_id, title: rows[3].title, artist: rows[3].artist }];
  await page.route('**/api/requests/*/bridges', (route) => route.fulfill({ json: {
    looked_at: 40, direct: false,
    options: [{ best: true, songs: [{ id: bridge.id, title: bridge.title, artist: bridge.artist, bridge: true }, { id: all[4].id, title: all[4].title, artist: all[4].artist, bridge: false }], song_ids: [bridge.id, all[4].id], after_id: first.id, after: first.title, before: null, words: 'Close in tempo all the way.', transitions: [] }],
  } }));
  const drawer = await openDrawer(page, rows, 1440, 1000);
  const described = async (button: Locator, words: RegExp) => {
    const id = await button.getAttribute('aria-describedby');
    expect(id, 'the action names no consequence').toBeTruthy();
    await expect(drawer.locator(`[id="${id}"]`)).toHaveText(words);
    await expect(button).toHaveAccessibleDescription(words);
  };
  // the approval: both choices say what follows
  await described(drawer.getByRole('button', { name: 'Add both' }), /one extra song joins with .+, in the order above/);
  await described(drawer.getByRole('button', { name: 'No, keep waiting' }), /nothing extra joins/);
  // a song with no place yet: adding it straight away is the rough option, and says so
  await described(drawer.getByRole('button', { name: 'Add to mix anyway' }), /may make a rough transition/);
  // other bridges: Use this says how many songs join and when
  await drawer.locator('.request-row[data-stage="approve"]').first().getByRole('button', { name: 'See other bridges' }).click();
  const use = drawer.getByRole('button', { name: 'Use this' }).first();
  await expect(use).toBeVisible();
  // its route diagram: one arrow between each pair, the bridge before the request, as they would play
  const diagram = drawer.locator('.bridge-options .music-route.compact').first();
  await expect(diagram.locator('.music-route-arrow')).toHaveCount(1);
  await expect(diagram).toHaveAttribute('aria-label', `Proposed route - nothing added. ${bridge.title} → ${all[4].title}`);
  expect(await diagram.locator('.music-route-icons > span').evaluateAll((spans) => spans.map((span) => span.className))).toEqual(['bridge', 'wanted']);
  await described(use, /^Adds one extra song with .+\. They join together once every transition is ready, and none of them plays before that\.$/);
  await drawer.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).last().click();
  // a bridge already agreed to can be turned down, and that says nothing extra joins
  await drawer.locator('.request-row[data-stage="preparing"]').filter({ hasText: all[8].title }).getByRole('button', { name: 'Find a different bridge' }).click();
  const none = drawer.getByRole('button', { name: 'Don’t use a bridge' });
  await expect(none).toBeVisible();
  await described(none, /No extra songs join/);
  // the primary action is the one that adds; the others are quieter
  const fill = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await fill(use)).not.toBe(await fill(none));
});

test('MP-0290-06 a late answer cannot bring back a cancelled request', async ({ page, request }) => {
  const all = await songs(request);
  const rows = rowsFor(all);
  let hold: Promise<void> | null = null;
  let release: () => void = () => undefined;
  await page.route('**/api/requests', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    // the poll that started before the cancel answers after it, still listing the request
    const snapshot = JSON.parse(JSON.stringify(rows));
    if (hold) await hold;
    await route.fulfill({ json: { requests: snapshot } });
  });
  await page.route('**/api/requests/903', (route) => route.fulfill({ json: { requests: rows.filter((row) => row.id !== 903), cancelled: true } }));
  // the look for a spot is late too: it still lists the request it started with
  await page.route('**/api/requests/consider', (route) => route.fulfill({ json: { requests: rows } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('button', { name: /^Requests/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  const target = drawer.locator('.request-row').filter({ hasText: all[7].title });
  await expect(target).toHaveCount(1);
  hold = new Promise((resolve) => { release = resolve; });
  // let a poll start and stall, then cancel
  await page.waitForTimeout(2000);
  await drawer.getByRole('button', { name: `Cancel request for ${all[7].title}` }).click();
  await expect(target).toHaveCount(0);
  release();
  hold = null;
  // several polls later it is still gone, while the others stay
  await page.waitForTimeout(4000);
  await expect(target).toHaveCount(0);
  await expect(drawer.locator('.request-row')).toHaveCount(4);
});

test('MP-0290-07 (automated part) the player and toasts never cover the drawer’s Submit or Cancel', async ({ page, request }) => {
  const all = await songs(request);
  const rows = rowsFor(all);
  // 375 x 420 stands in for a phone with its keyboard up; a real keyboard needs a real phone
  for (const [width, height] of [[375, 420], [375, 812], [1440, 900]] as const) {
    const drawer = await openDrawer(page, rows, width, height);
    // a toast on screen as well: a cancel that fails says so
    await page.route('**/api/requests/905', (route) => route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }));
    await drawer.getByRole('button', { name: `Cancel request for ${all[9].title}` }).click();
    await expect(page.getByText('Couldn’t cancel that. It’s still on the list.').first()).toBeVisible();
    const search = drawer.getByRole('combobox', { name: 'Request a song' });
    await search.focus();
    const actions = [
      drawer.getByRole('button', { name: 'Add both' }),
      drawer.getByRole('button', { name: 'No, keep waiting' }),
      drawer.getByRole('button', { name: 'Add to mix anyway' }),
      ...rows.map((row) => drawer.getByRole('button', { name: `Cancel request for ${row.title}` })),
      drawer.getByRole('button', { name: 'Close Requests', exact: true }),
    ];
    for (const action of actions) {
      await action.scrollIntoViewIfNeeded();
      const name = await action.getAttribute('aria-label') ?? await action.textContent();
      expect(await unobscured(action), `${width}x${height}: "${name}" is covered`).toBe(true);
    }
    await page.unroute('**/api/requests/905');
    await page.keyboard.press('Escape');
  }
});
