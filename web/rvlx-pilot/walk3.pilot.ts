import { APIRequestContext, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const out: Record<string, unknown> = {};
async function convo(request: APIRequestContext, turns: string[], title: string) {
  const made = await (await request.post('/api/lucy/conversations', { data: { title } })).json();
  for (const [index, text] of turns.entries()) {
    await request.post(`/api/lucy/conversations/${made.id}/turns`, { data: { client_id: `p-${Date.now()}-${index}`, text, expected_revision: null } });
    for (let t = 0; t < 60; t += 1) {
      const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
      if (snap.messages.filter((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete').length >= index + 1) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return made.id as string;
}
async function step(key: string, fn: () => Promise<void>) { try { await fn(); } catch (e) { out[`${key}:error`] = String(e).slice(0, 300); } }
test('pilot 3', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  const id = await convo(request, ['make me 6 songs', 'keep Last Call and make it calmer'], 'Pilot walk');
  await step('critique', async () => {
    const snap = await (await request.get(`/api/lucy/conversations/${id}`)).json();
    out.replies = snap.messages.filter((m: { role: string }) => m.role === 'assistant').map((m: { text?: string; content?: string }) => m.text ?? m.content);
    await page.goto(`/mixes/lucy/${id}`); await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /Your mix/i }).first().click(); await page.waitForTimeout(800);
    const t = await page.locator('main').innerText();
    out.mixHead = t.slice(t.indexOf('YOUR MIX'), t.indexOf('YOUR MIX') + 700);
    out.songs = [...t.matchAll(/Song \d+:\n([^\n]+)/g)].map((m) => m[1]);
    out.metWords = (t.match(/[^\n]*(not met|met|unknown|kept|locked)[^\n]*/gi) ?? []).slice(0, 20);
  });
  await step('convs', async () => {
    await page.getByRole('button', { name: 'Conversations' }).or(page.getByRole('link', { name: 'Conversations' })).first().click(); await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'More for Pilot walk' }).click(); await page.waitForTimeout(400);
    out.menu = await page.getByRole('menuitem').allInnerTexts();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    out.deleteDialog = await page.getByRole('dialog').last().innerText();
    await page.getByRole('button', { name: 'Keep it' }).click();
  });
  writeFileSync(process.env.RVLX_OUT ?? 'pilot3.json', JSON.stringify(out, null, 1));
});
