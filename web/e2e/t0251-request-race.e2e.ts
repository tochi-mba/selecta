import { expect, test, type APIRequestContext } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * T0251: one scenario through the real server and the real Requests drawer. Two requests arrive at
 * the same moment and compete for the same spot; the person approves one request's bridge with a
 * click, which the real server checks and records; the other is cancelled while an answer read
 * before the cancel is still on its way, and that late answer must not bring it back.
 *
 * Only the planner's verdict is fixed (both requests offered the same spot, one needing a bridge),
 * because the made-up library can't promise a bridge. Every write (the requests, the bridge choice
 * and the cancel) reaches the real server, and each answer the page sees is the server's list read
 * when the page asked, delivered late.
 */
type Song = { id: number; title: string; artist: string };
type Row = { id: number; song_id: number };
const LATE_MS = 2500;

async function songs(request: APIRequestContext): Promise<Song[]> {
  const all = (await (await request.get('/api/songs?q=&state=all&limit=40')).json()) as Song[];
  return all.filter((song) => song.title && song.artist && song.id > 4).sort((one, other) => one.id - other.id);
}

async function serverRows(request: APIRequestContext): Promise<Row[]> {
  return ((await (await request.get('/api/requests')).json()) as { requests: Row[] }).requests;
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request, [1, 2, 3, 4]);
  for (const row of await serverRows(request)) await request.delete(`/api/requests/${row.id}`);
});

test('T0251 two requests race for one spot, one bridge is approved and a late answer cannot revive the cancelled one', async ({ page, request }) => {
  test.setTimeout(90_000);
  const [wanted, rival, bridge] = await songs(request);
  const first = ((await (await request.get('/api/mix')).json()) as { mix: { song_id: number; title: string }[] }).mix[0];

  // two requests at the same moment, one sent twice: each song is asked for once
  await Promise.all([
    request.post('/api/requests', { data: { song_id: wanted.id } }),
    request.post('/api/requests', { data: { song_id: rival.id } }),
    request.post('/api/requests', { data: { song_id: rival.id } }),
  ]);
  const asked = await serverRows(request);
  expect(asked.map((row) => row.song_id).sort()).toEqual([wanted.id, rival.id].sort());
  const idOf = (song: Song) => asked.find((row) => row.song_id === song.id)!.id;

  // the planner's verdict: both want the spot after the first song; the wanted song needs a bridge
  const verdict = (id: number, bridgeChoice: boolean | null) => {
    if (id === idOf(wanted)) {
      return {
        id, song_id: wanted.id, title: wanted.title, artist: wanted.artist, status: 'pending', available: 1,
        stage: bridgeChoice ? 'preparing' : 'approve', needs_approval: !bridgeChoice, bridge_choice: bridgeChoice,
        after: first.title, after_id: first.song_id, seconds: 40,
        route: [{ id: bridge.id, title: bridge.title, artist: bridge.artist }, { id: wanted.id, title: wanted.title, artist: wanted.artist }],
        transitions: [{ from: first.title, to: bridge.title, key: 't1', status: 'waiting' }, { from: bridge.title, to: wanted.title, key: 't2', status: 'waiting' }],
      };
    }
    // the rival can't share that spot, so it keeps searching
    return { id, song_id: rival.id, title: rival.title, artist: rival.artist, status: 'pending', available: 1, stage: 'searching' };
  };
  // each answer is the server's list as it was when the page asked, delivered late
  const late = async (route: import('@playwright/test').Route) => {
    const now = (await serverRows(request)) as (Row & { bridge_choice?: boolean | null })[];
    const rows = now.map((row) => verdict(row.id, row.bridge_choice ?? null));
    await new Promise((resolve) => setTimeout(resolve, LATE_MS));
    await route.fulfill({ json: { requests: rows } }).catch(() => undefined);
  };
  await page.route('**/api/requests', (route) => (route.request().method() === 'GET' ? late(route) : route.fallback()));
  await page.route('**/api/requests/consider', late);

  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('button', { name: /^Requests/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  await expect(drawer).toBeVisible();

  // the approval goes to the real server, which checks the route and holds the request to it
  const add = drawer.getByRole('button', { name: 'Add both' });
  await expect(add).toBeVisible({ timeout: 20_000 });
  const approved = page.waitForResponse((response) => response.url().endsWith(`/api/requests/${idOf(wanted)}/bridge`));
  await add.click();
  expect((await approved).status()).toBe(200);
  await expect.poll(async () => {
    const rows = (await serverRows(request)) as (Row & { bridge_choice?: boolean | null; picked?: number[] | null })[];
    const row = rows.find((one) => one.id === idOf(wanted));
    return { choice: row?.bridge_choice, picked: row?.picked };
  }).toEqual({ choice: true, picked: [bridge.id, wanted.id] });
  // the rival, still waiting for its own spot, was not approved with it
  const rivalRow = (await serverRows(request)).find((row) => row.id === idOf(rival)) as Row & { bridge_choice?: boolean | null };
  expect(rivalRow.bridge_choice ?? null).toBeNull();

  // cancel the rival while an answer read before the cancel is still on its way
  const cancel = drawer.getByRole('button', { name: `Cancel request for ${rival.title}` });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await page.waitForTimeout(LATE_MS * 3);
  await expect(cancel).toHaveCount(0);
  expect((await serverRows(request)).map((row) => row.id)).toEqual([idOf(wanted)]);
  // the approved request is still there and still holds its bridge
  await expect(drawer.getByText(wanted.title).first()).toBeVisible();

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await request.delete(`/api/requests/${idOf(wanted)}`).catch(() => undefined);
});
