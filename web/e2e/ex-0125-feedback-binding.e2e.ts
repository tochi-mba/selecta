import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * EX-0125-04: a Good/Bad rating stays attached to the exact pair and transition version that was heard.
 * The unit test (`web/src/views/LinksRating.test.tsx`) covers the late answer in isolation; this spec runs
 * the same race in a real browser, and adds the changed-pair case: the list of word connections changes
 * under the card while its rating is still on its way. The lyric search is a fixture; the clip is a real
 * synthetic song from the e2e server.
 */
type State = { status: string; key: string; passed?: boolean; label?: string; rating?: string };
function link(a: number, b: number, titleA: string, titleB: string, phrase: string, state: State) {
  return {
    phrase, kind: 'end-start', a, b, artist_a: 'Ada Reyes', title_a: titleA, artist_b: 'Bo Lindqvist', title_b: titleB,
    line_a: `we danced ${phrase}`, line_b: `${phrase} we sang`, moves: ['word_blend', 'word_cut'], move: 'word_blend', state, worked: true,
  };
}
const heard = (key: string, rating?: string): State => ({ status: 'ready', key, label: 'Word blend', passed: true, ...(rating ? { rating } : {}) });

/** Every rating request is recorded and held until the test lets its answer go. */
async function holdRatings(page: Page) {
  const sent: { key: string; body: unknown }[] = [];
  const waiting: { route: Route; key: string; body: { rating: string } }[] = [];
  await page.route('**/api/seams/*/rate', async (route) => {
    const key = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    const body = route.request().postDataJSON() as { rating: string };
    sent.push({ key, body });
    waiting.push({ route, key, body });
  });
  const answer = async () => {
    const next = waiting.shift();
    if (!next) throw new Error('no rating is waiting');
    await next.route.fulfill({ json: heard(next.key, next.body.rating) });
  };
  return { sent, answer };
}

async function clips(page: Page) {
  const clip = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/seams/*/preview*', (route) => route.fulfill({ body: clip, contentType: 'audio/flac' }));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await clips(page);
});

test('EX-0125-04 changing the move while a rating is saved keeps the rating on the version heard', async ({ page }) => {
  await page.route('**/api/links?**', (route) => route.fulfill({ json: { links: [link(1, 2, 'Morning Light', 'Slow Tide', 'tonight', heard('ex125-heard'))], prepared: 1, preparing: 0 } }));
  await page.route('**/api/seams', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ json: { status: 'rendering', key: 'ex125-new' } })
    : route.continue()));
  await page.route('**/api/seams/ex125-new', (route) => route.fulfill({ json: { status: 'rendering', key: 'ex125-new' } }));
  const ratings = await holdRatings(page);
  await page.goto('/discover');
  const card = page.locator('.link-card').first();
  await card.getByRole('button', { name: 'Good', exact: true }).click();
  await expect.poll(() => ratings.sent.length).toBe(1);
  // the move changes while the rating is still on its way
  const cut = card.getByRole('group', { name: 'Which move' }).getByRole('button').nth(1);
  await cut.click();
  await expect(cut).toHaveAttribute('aria-pressed', 'true');
  await ratings.answer();
  expect(ratings.sent[0]).toEqual({ key: 'ex125-heard', body: { rating: 'good' } });
  // the late answer for the heard version does not take the card back from the new render
  await expect(card.getByRole('button', { name: /Rendering/ })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Good', exact: true })).toHaveCount(0);
  await expect(cut).toHaveAttribute('aria-pressed', 'true');
});

test('EX-0125-04 a rating stays on its pair when the list of connections changes before it is saved', async ({ page }) => {
  const first = link(1, 2, 'Morning Light', 'Slow Tide', 'tonight', heard('ex125-a'));
  const newcomer = link(3, 4, 'Paper Moon', 'Neon Rain', 'tonight', heard('ex125-b'));
  let rated = false;
  let changed = false;
  await page.route('**/api/links?**', (route) => {
    const links = changed ? [newcomer, { ...first, state: heard('ex125-a', rated ? 'good' : undefined) }] : [first];
    return route.fulfill({ json: { links, prepared: links.length, preparing: 0 } });
  });
  const ratings = await holdRatings(page);
  await page.goto('/discover');
  const cardFor = (song: number) => page.locator('.link-card').filter({ has: page.locator(`.link-handoff[data-song="${song}"]`) });
  await expect(page.locator('.link-card')).toHaveCount(1);
  await cardFor(1).getByRole('button', { name: 'Good', exact: true }).click();
  await expect.poll(() => ratings.sent.length).toBe(1);
  // a new pair arrives at the top of the list while the rating is still on its way
  changed = true;
  // the page looks again on its own every six seconds
  await expect(page.locator('.link-card')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('.link-card').first().locator('.link-handoff').first()).toHaveAttribute('data-song', '3');
  rated = true;
  await ratings.answer();
  expect(ratings.sent).toEqual([{ key: 'ex125-a', body: { rating: 'good' } }]);
  // the answer lands on the pair that was rated, never on the card that took its place
  await expect(cardFor(1).getByRole('button', { name: 'Good', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(cardFor(3).getByRole('button', { name: 'Good', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(cardFor(3).getByRole('button', { name: 'Bad', exact: true })).toHaveAttribute('aria-pressed', 'false');
});
