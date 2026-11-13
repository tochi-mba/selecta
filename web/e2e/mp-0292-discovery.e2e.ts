import { expect, test, type Locator, type Page } from '@playwright/test';
import { allRendered, resetMix } from './helpers';

/**
 * ADR-0292 word connections and chord matches: ordered pair headers, the diagrams' meaning, audition
 * stages that never claim audio they have not got, readable verdict actions, specific failure states,
 * duplicate titles told apart by exact IDs, and the add destination spelled out. Fixtures stand in for
 * the lyric and chord searches; the audio is a real synthetic song. Candidates for an independent reviewer.
 */
const ready = { status: 'ready', key: 'mp292', label: 'Word blend', style: 'word_blend', passed: true };
function link(a: number, b: number, titleA: string, titleB: string, phrase = 'all night') {
  return { phrase, kind: 'end-start', a, b, artist_a: 'Ada Reyes', title_a: titleA, artist_b: 'Bo Lindqvist', title_b: titleB, line_a: `we danced ${phrase}`, line_b: `${phrase} we sang`, moves: ['word_blend', 'word_cut'], move: 'word_blend', state: { ...ready, key: `mp292-${a}-${b}` }, worked: true };
}
function pair(id: number, a: number, b: number, titleA: string, titleB: string) {
  return { id, song_a: a, song_b: b, title_a: titleA, title_b: titleB, artist_a: 'Ada Reyes', artist_b: 'Bo Lindqvist', status: 'new', payload: { a_at: 10, b_at: 20, bars: 4, transpose: 0 } };
}

async function words(page: Page, links: unknown[]) {
  await page.route('**/api/links?**', (route) => route.fulfill({ json: { links, prepared: links.length, preparing: links.length } }));
}

async function chords(page: Page, pairs: unknown[], hearing: 'ok' | 'broken' = 'ok') {
  const clip = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/discoveries', (route) => route.fulfill({ json: pairs }));
  await page.route('**/api/discoveries/*/hear', (route) => route.fulfill({ json: { chords: ['C', 'G', 'Am', 'F'], bar_starts: [0, 2, 4, 6], seconds: 8, semitones: 0 } }));
  await page.route('**/api/discoveries/*/hear/*', (route) => (hearing === 'ok' ? route.fulfill({ body: clip, contentType: 'audio/flac' }) : route.fulfill({ status: 404, body: 'gone' })));
  await page.route('**/api/discoveries/*/review', (route) => route.fulfill({ json: { ok: true } }));
}

const box = (locator: Locator) => locator.evaluate((element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0292-01 both songs, their order and the kind of connection are unambiguous', async ({ page }) => {
  await words(page, [link(1, 2, 'Morning Light', 'Slow Tide')]);
  await chords(page, [pair(7, 3, 4, 'Paper Moon', 'Glass Harbour')]);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/discover');
    const card = page.locator('.link-card').first();
    await expect(card.locator('.link-kind')).toHaveText('Word connection, in playing order');
    await expect(card.locator('.link-handoff').nth(0)).toContainText('From Morning Light');
    await expect(card.locator('.link-handoff').nth(1)).toContainText('Into Slow Tide');
    await expect(card.locator('.link-handoff').nth(0)).toHaveAttribute('data-song', '1');
    const [first, second] = [await box(card.locator('.link-handoff').nth(0)), await box(card.locator('.link-handoff').nth(1))];
    expect(first.bottom, `${width}px: the order is not top to bottom`).toBeLessThanOrEqual(second.top + 1);
    const orders = await card.locator('.link-order').evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().left));
    expect(Math.abs(orders[0] - orders[1]), `${width}px: From and Into do not line up`).toBeLessThanOrEqual(1);
    expect(await card.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

    await page.goto('/discover/harmonic');
    const discovery = page.locator('.discovery');
    await expect(discovery.locator('.link-kind')).toHaveText('Chord match, a suggestion to check by ear, not a verified match');
    await expect(discovery).toHaveAttribute('data-pair', '3>4');
    await expect(discovery.locator('h3')).toHaveText('Paper Moon and Glass Harbour');
  }
});

test('MP-0292-02 seam and route diagrams keep their evidence meaning', async ({ page, request }) => {
  await resetMix(request, [1, 2, 3]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mix/current/edit');
  const diagrams = page.locator('.timeline .music-seam-diagram');
  await expect(diagrams).toHaveCount(2);
  const meaning = async (diagram: Locator) => ({ label: await diagram.getAttribute('aria-label'), state: await diagram.getAttribute('data-state'), shown: await diagram.locator('.music-seam-label').textContent(), edge: await diagram.evaluate((element) => getComputedStyle(element).borderInlineStartStyle + getComputedStyle(element).borderTopStyle) });
  // before anything is made, the diagram says it is a plan, with a dashed edge
  const first = await meaning(diagrams.first());
  if (first.state !== 'ready') {
    expect(first.label).toMatch(/^(Planned, not rendered|Queued to render|Rendering)\./);
    expect(first.edge).toMatch(/dashed|dotted/);
  }
  await allRendered(request);
  await page.reload();
  const made = await meaning(page.locator('.timeline .music-seam-diagram').first());
  expect(made.state).toBe('ready');
  expect(made.label).toMatch(/^Rendered transition\. .+\. from .+ into .+/);
  expect(made.shown).toMatch(/^Rendered transition · /);
  expect(made.edge).not.toMatch(/dashed/);
  // the lines run in playing order: the outgoing song starts left of where the incoming one ends
  const lines = await page.locator('.timeline .music-seam-diagram').first().evaluate((diagram) => {
    const out = diagram.querySelector('.outgoing')!.getBoundingClientRect();
    const into = diagram.querySelector('.incoming')!.getBoundingClientRect();
    return { outLeft: out.left, intoRight: into.right, outWidth: out.width, intoWidth: into.width };
  });
  expect(lines.outLeft).toBeLessThan(lines.intoRight);
  expect(lines.outWidth).toBeGreaterThan(0);
  expect(lines.intoWidth).toBeGreaterThan(0);
  // (route diagrams' arrows and order are measured with the bridge finder in mp-0290-requests.e2e.ts 'MP-0290-05')
});

test('MP-0292-03 chords, song A, song B and both never claim audio that has not started', async ({ page }) => {
  await chords(page, [pair(7, 3, 4, 'Paper Moon', 'Glass Harbour')]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/discover/harmonic');
  const now = page.locator('.discovery-now');
  await expect(now).toHaveText('Nothing is playing');
  await page.getByRole('button', { name: 'Hear what SelectaDJ heard' }).click();
  const stages = page.getByRole('list', { name: 'Four stages to hear' }).getByRole('button');
  await expect(stages).toHaveText(['1 The chords SelectaDJ heard', '2 Paper Moon, with those chords', '3 Glass Harbour, moved to the same key and speed', '4 Both at once']);
  // only the media element saying it is playing moves the marker
  await expect(now).toHaveText(/^(Loading stage 1; no audio confirmed yet|Now playing: The chords SelectaDJ heard)$/);
  await expect(now).toHaveText('Now playing: The chords SelectaDJ heard', { timeout: 20_000 });
  await expect(stages.nth(0)).toHaveAttribute('aria-current', 'step');
  await stages.nth(2).click();
  await expect(now).toHaveText('Now playing: Glass Harbour, moved to the same key and speed', { timeout: 20_000 });
  await expect(page.locator('.discovery-steps [aria-current="step"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(now).toHaveText('Nothing is playing');
  await expect(page.locator('.discovery-steps [aria-current="step"]')).toHaveCount(0);
});

test('MP-0292-03 a clip that cannot load is never shown as playing', async ({ page }) => {
  await chords(page, [pair(7, 3, 4, 'Paper Moon', 'Glass Harbour')], 'broken');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/discover/harmonic');
  await page.getByRole('button', { name: 'Hear what SelectaDJ heard' }).click();
  await expect(page.getByRole('alert')).toContainText(/unavailable|Couldn’t play/);
  await expect(page.locator('.discovery-now')).toHaveText('Nothing is playing');
  await expect(page.locator('.discovery-steps [aria-current="step"]')).toHaveCount(0);
});

test('MP-0292-04 Yes, No, Skip, Add both and Change move stay readable and in tiers', async ({ page }) => {
  await chords(page, [pair(7, 3, 4, 'Paper Moon', 'Glass Harbour'), pair(8, 5, 6, 'Night Bus', 'Copper Line')]);
  await words(page, [link(1, 2, 'Morning Light', 'Slow Tide')]);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/discover/harmonic');
    const verdicts = page.getByRole('group', { name: 'Do Paper Moon and Glass Harbour sound connected?' }).getByRole('button');
    await expect(verdicts).toHaveText(['Yes', 'No', 'Skip for now']);
    const hear = await box(page.getByRole('button', { name: 'Hear what SelectaDJ heard' }));
    for (const index of [0, 1, 2]) {
      const verdict = await box(verdicts.nth(index));
      expect(verdict.height, `${width}px: a verdict is under 44px`).toBeGreaterThanOrEqual(44);
      expect(verdict.right).toBeLessThanOrEqual(width);
      // hearing comes first: the verdicts follow the audition, not the other way round
      expect(verdict.top).toBeGreaterThan(hear.top);
    }
    const fill = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await fill(page.getByRole('button', { name: 'Hear what SelectaDJ heard' }))).not.toBe(await fill(verdicts.nth(0)));

    await page.goto('/discover');
    const card = page.locator('.link-card').first();
    const moves = card.getByRole('group', { name: 'Which move' }).getByRole('button');
    const add = card.getByRole('button', { name: /^Add both to/ });
    await expect(add).toBeVisible();
    for (const control of [add, moves.nth(0), moves.nth(1), card.getByRole('button', { name: 'Play it' })]) {
      const shape = await box(control);
      expect(shape.height, `${width}px: a card action is under 44px`).toBeGreaterThanOrEqual(44);
      expect(shape.right, `${width}px: a card action runs off the card`).toBeLessThanOrEqual((await box(card)).right + 1);
      const words = await control.evaluate((element) => ({ cut: element.scrollWidth > element.clientWidth + 1, size: parseFloat(getComputedStyle(element).fontSize) }));
      expect(words.cut, `${width}px: a card action's words are cut`).toBe(false);
      expect(words.size).toBeGreaterThanOrEqual(13);
    }
  }
});

test('MP-0292-05 loading, failed and empty states each say what is going on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // loading
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/discoveries', async (route) => { await held; await route.fulfill({ json: [] }); });
  await page.route('**/api/links?**', async (route) => { await held; await route.fulfill({ json: { links: [], prepared: 0, preparing: 0 } }); });
  await page.goto('/discover/harmonic');
  await expect(page.locator('[aria-label="Finding harmonic discoveries"]').or(page.getByText('Finding harmonic discoveries')).first()).toBeAttached();
  await page.goto('/discover');
  await expect(page.locator('[aria-label="Searching your lyrics"]').or(page.getByText('Searching your lyrics')).first()).toBeAttached();
  release();
  // empty
  await expect(page.getByText('No links yet. Analysing more songs will find more.')).toBeVisible();
  await page.goto('/discover/harmonic');
  await expect(page.getByText('No chord matches to hear yet. They turn up as more of your library is analysed.')).toBeVisible();
  // failed
  await page.unroute('**/api/discoveries');
  await page.unroute('**/api/links?**');
  await page.route('**/api/discoveries', (route) => route.fulfill({ status: 500, json: { detail: 'synthetic' } }));
  await page.route('**/api/links?**', (route) => route.fulfill({ status: 500, json: { detail: 'synthetic' } }));
  await page.goto('/discover/harmonic');
  await expect(page.locator('.problem').first()).toContainText('Couldn’t load these. Try again in a moment.');
  await page.goto('/discover');
  await expect(page.locator('.problem').first()).toContainText('Couldn’t search your lyrics. Nothing’s lost.');
  // a candidate that could not be rendered says why, in its own card
  await page.unroute('**/api/links?**');
  const broken = { ...link(1, 2, 'Morning Light', 'Slow Tide'), worked: false, state: { status: 'failed', key: 'mp292-f', error: 'The vocal line could not be isolated.' } };
  await words(page, [broken]);
  await page.goto('/discover');
  await page.getByText('1 didn’t work so well').click();
  await expect(page.locator('.link-card.failed .warn')).toHaveText('The vocal line could not be isolated.');
  await expect(page.locator('.link-card.failed').getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('MP-0292-06 two songs with the same title are told apart by their exact ordered IDs', async ({ page }) => {
  await words(page, [link(11, 12, 'Home', 'Home', 'come home')]);
  await chords(page, [pair(9, 13, 14, 'Home', 'Home')]);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/discover');
  const card = page.locator('.link-card').first();
  await expect(card.locator('.link-handoff').nth(0)).toContainText('From Home (song 11)');
  await expect(card.locator('.link-handoff').nth(1)).toContainText('Into Home (song 12)');
  await expect(card.locator('.link-destination')).toContainText('Adds Home (song 11), then Home (song 12)');
  await card.getByRole('button', { name: 'Play it' }).click();
  await expect(card.locator('audio')).toHaveAttribute('aria-label', 'Home (song 11) into Home (song 12)');
  await page.goto('/discover/harmonic');
  await expect(page.locator('.discovery h3')).toHaveText('Home (song 13) and Home (song 14)');
  await expect(page.locator('.discovery')).toHaveAttribute('data-pair', '13>14');
});

test('MP-0292-07 adding says where both go, in what order, all at once', async ({ page, request }) => {
  await resetMix(request, [3, 4]);
  await words(page, [link(1, 2, 'Morning Light', 'Slow Tide')]);
  let sent: { url: string; body: { a: number; b: number } } | null = null;
  await page.route('**/api/mix/pair*', async (route) => {
    sent = { url: route.request().url(), body: route.request().postDataJSON() };
    await route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/discover');
  const card = page.locator('.link-card').first();
  const destination = card.locator('.link-destination');
  await expect(destination).toContainText('Adds Morning Light, then Slow Tide, joined by this transition, both at once or neither.');
  await expect(destination).toContainText(/the mix you choose: your current mix or one draft|your current mix/);
  const add = card.getByRole('button', { name: /^Add both to/ });
  if ((await add.textContent())?.includes('the mix')) await expect(add).toHaveAccessibleDescription(/Adds Morning Light, then Slow Tide/);
  // the server's answer to the add, so the mix is read after it has changed, not while the add is on its way
  const answered = page.waitForResponse((response) => response.url().includes('/api/mix/pair') && response.request().method() === 'POST');
  if ((await add.textContent())?.includes('to…')) {
    await add.click();
    await page.getByRole('menuitem', { name: 'Your current mix' }).click();
  } else {
    await add.click();
  }
  await expect.poll(() => sent).not.toBeNull();
  expect(sent!.url).not.toContain('draft=');
  expect([sent!.body.a, sent!.body.b]).toEqual([1, 2]);
  expect((await answered).ok(), 'the add was refused').toBe(true);
  const { mix } = await (await request.get('/api/mix')).json();
  expect(mix.map((item: { song_id: number }) => item.song_id)).toEqual([3, 4, 1, 2]);
});
