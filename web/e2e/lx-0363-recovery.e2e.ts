/* LX-0363-04/05: durable per-conversation context and explicit recovery in real browser tabs.
 * The built-in planner supplies proposals, so these tests never call a remote AI service. */
import { APIRequestContext, BrowserContext, expect, Page, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

async function conversation(request: APIRequestContext, title: string, prompt?: string): Promise<string> {
  const made = await (await request.post('/api/lucy/conversations', { data: { title } })).json();
  if (prompt) await turn(request, made.id, prompt);
  return made.id;
}

async function turn(request: APIRequestContext, id: string, text: string): Promise<number> {
  const before = await (await request.get(`/api/lucy/conversations/${id}`)).json();
  const previous = before.proposal?.current?.number ?? 0;
  const messages = before.messages.filter((item: { role: string; status: string }) =>
    item.role === 'assistant' && item.status === 'complete').length;
  const sent = await request.post(`/api/lucy/conversations/${id}/turns`, {
    data: {
      client_id: `lx-context-${Date.now()}-${Math.random()}`,
      text,
      expected_revision: before.proposal?.current?.id ?? null,
    },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => {
    const snapshot = await (await request.get(`/api/lucy/conversations/${id}`)).json();
    return snapshot.messages.filter((item: { role: string; status: string }) =>
      item.role === 'assistant' && item.status === 'complete').length;
  }, { timeout: 60_000 }).toBe(messages + 1);
  const after = await (await request.get(`/api/lucy/conversations/${id}`)).json();
  expect(after.proposal.current.number).toBeGreaterThan(previous);
  return after.proposal.current.number;
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message to Lucy' });

async function open(context: BrowserContext, id: string): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`/mixes/lucy/${id}`);
  await expect(composer(page)).toBeVisible();
  return page;
}

test('LX-0363-04 two tabs share the latest proposal pointer but never leak another conversation draft', async ({ context, page, request }) => {
  const first = await conversation(request, 'First tab', 'make me 6 songs');
  const second = await conversation(request, 'Second tab');
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.goto(`/mixes/lucy/${first}`);
  const peer = await open(context, first);

  await composer(page).fill('Half-written words for the first conversation');
  await peer.reload();
  await expect(composer(peer)).toHaveValue('Half-written words for the first conversation');

  await peer.goto(`/mixes/lucy/${second}`);
  await expect(composer(peer)).toHaveValue('');
  await composer(peer).fill('A separate thought for the second conversation');
  await page.reload();
  await expect(composer(page)).toHaveValue('Half-written words for the first conversation');
  await peer.goto(`/mixes/lucy/${first}`);
  await expect(composer(peer)).toHaveValue('Half-written words for the first conversation');

  const current = await turn(request, first, 'make it shorter');
  for (const tab of [page, peer]) {
    await expect(tab.getByRole('button', { name: `Revision ${current}` })).toBeVisible({ timeout: 30_000 });
    await expect(composer(tab)).toHaveValue('Half-written words for the first conversation');
  }
});

test('LX-0363-05 network loss keeps typed words and catches up to work completed while disconnected', async ({ page, request }) => {
  const id = await conversation(request, 'Network recovery', 'make me 6 songs');
  await page.goto(`/mixes/lucy/${id}`);
  await expect(composer(page)).toBeVisible();
  await composer(page).fill('Keep these words while the network is gone');

  const events = `**/api/lucy/conversations/${id}/events*`;
  await page.route(events, (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(composer(page)).toHaveValue('Keep these words while the network is gone');
  await expect(page.getByText(/What.s shown may be out of date, and anything you type is kept/)).toBeVisible({ timeout: 30_000 });

  const current = await turn(request, id, 'make it shorter');
  await page.unroute(events);
  await expect(page.getByRole('button', { name: `Revision ${current}` })).toBeVisible({ timeout: 30_000 });
  await expect(composer(page)).toHaveValue('Keep these words while the network is gone');
});

test('LX-0363-05 a page opened while the server is unavailable offers retry and recovers its draft', async ({ page, request }) => {
  const id = await conversation(request, 'Restart recovery', 'make me 6 songs');
  await page.goto(`/mixes/lucy/${id}`);
  await composer(page).fill('Still here after the server comes back');

  const snapshot = `**/api/lucy/conversations/${id}`;
  await page.route(snapshot, (route) => route.fulfill({ status: 503, json: { detail: 'Restarting' } }));
  await page.reload();
  await expect(page.getByText(/Couldn.t open this conversation/)).toBeVisible();
  await page.unroute(snapshot);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(composer(page)).toHaveValue('Still here after the server comes back');
  await expect(page.getByRole('button', { name: 'Revision 1' })).toBeVisible();
});
