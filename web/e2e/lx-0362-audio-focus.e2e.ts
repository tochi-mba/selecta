/* LX-0362-03: with real (muted) music playing, Lucy's Save and play never replaces it without an
 * explicit confirmation from the person: Cancel leaves the same player, the same mix and no draft;
 * only ticking "Yes, replace what's playing" and then the dialog's own button replaces the music
 * with the approved songs. Lucy's
 * built-in planner makes the proposal, so no AI service is ever called. */
import { APIRequestContext, expect, test } from '@playwright/test';
import { audioClock, resetMix, spyOnAudio } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMix(request);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

async function conversationWithProposal(request: APIRequestContext): Promise<string> {
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'LX audio focus' } })).json();
  const sent = await request.post(`/api/lucy/conversations/${made.id}/turns`, {
    data: { client_id: `lx-focus-${Date.now()}`, text: 'make me 4 songs', expected_revision: null },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => {
    const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
    return snap.messages.filter((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete').length;
  }, { timeout: 60_000 }).toBe(1);
  return made.id;
}

const mixIds = async (request: APIRequestContext) =>
  (await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id);

test('LX-0362-03 Save and play replaces the playing music only after its own confirmation', async ({ page, request }) => {
  const id = await conversationWithProposal(request);
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/listen');
  await page.locator('.now .transport .primary').click();
  await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
  const before = await mixIds(request);
  const drafts = (await (await request.get('/api/drafts')).json()).drafts.length;
  // client-side to Lucy, so the same player keeps going
  await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, `/mixes/lucy/${id}`);
  const contexts = (await audioClock(page)).length;
  // the stacked layout shows the proposal on its own tab
  const mixTab = page.getByRole('tab', { name: 'Your mix' });
  await expect(page.getByRole('textbox', { name: 'Message to Lucy' })).toBeVisible();
  if (await mixTab.isVisible()) await mixTab.click();
  const save = page.getByRole('button', { name: 'Save and play' });
  await save.click();
  const dialog = page.getByRole('dialog', { name: 'Save this mix and play it?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/replaces what.s playing/i);
  // the first focus is Cancel, so Enter alone never replaces the music
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  const clock = (await audioClock(page))[0];
  await page.waitForTimeout(1200);
  expect((await audioClock(page))[0]).toBeGreaterThan(clock);
  expect((await audioClock(page)).length).toBe(contexts);
  expect(await mixIds(request)).toEqual(before);
  expect((await (await request.get('/api/drafts')).json()).drafts.length).toBe(drafts);
  // the person's own confirmation is what replaces it
  await save.click();
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Save and play' });
  // replacing needs its own explicit agreement before the button does anything
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Yes, replace what’s playing with this mix' }).check();
  await confirm.click();
  const proposal = (await (await request.get(`/api/lucy/conversations/${id}`)).json()).proposal.current;
  const approved = proposal.snapshot.songs.map((song: { song_id: number }) => song.song_id);
  await expect.poll(() => mixIds(request), { timeout: 30_000 }).toEqual(approved);
  await expect(page.locator('.mini').getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  expect((await (await request.get('/api/drafts')).json()).drafts.length).toBe(drafts + 1);
});
