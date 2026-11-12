import { APIRequestContext, Page, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const out: Record<string, unknown> = {};
async function convo(request: APIRequestContext, turns: string[]) {
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'Pilot' } })).json();
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
const names = (page: Page, scope: string) => page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} a, ${s} summary, [role=menu] [role=menuitem], [role=menu] button`)]
  .filter((n) => (n as HTMLElement).getBoundingClientRect().width > 0)
  .map((n) => (n.getAttribute('aria-label') || (n as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ')), scope);
async function step(key: string, fn: () => Promise<void>) { try { await fn(); } catch (e) { out[`${key}:error`] = String(e).slice(0, 300); } }
test('pilot 2', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await step('counts', async () => { await page.goto('/library'); await page.locator('.library-count').waitFor(); out.counts = await page.locator('main').innerText().then((t) => t.slice(0, 400)); });
  await step('sheet', async () => {
    await page.goto('/library?song=11'); await page.waitForTimeout(1500);
    const sheet = page.locator('dialog[open], [role=dialog]').first();
    out.sheetControls = await names(page, 'dialog[open]');
    const sums = sheet.locator('summary, button').filter({ hasText: /advanced|detail|file|technical|more about/i });
    out.sheetSummaries = await sums.allInnerTexts();
    if (await sums.count()) await sums.first().click();
    out.sheetAfter = (await sheet.innerText()).slice(-1500);
  });
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  await step('critique', async () => {
    const id = await convo(request, ['make me 6 songs', 'keep Last Call and make it calmer']);
    await page.goto(`/mixes/lucy/${id}`); await page.waitForTimeout(2000);
    out.critique = (await page.locator('main').innerText()).slice(-1500);
    await page.getByRole('tab', { name: /Your mix/i }).first().click(); await page.waitForTimeout(800);
    out.critiqueMix = (await page.locator('main').innerText()).slice(0, 1500);
    await page.getByRole('button', { name: 'Conversations' }).first().click(); await page.waitForTimeout(800);
    out.convs = await names(page, 'body');
    const more = page.getByRole('button', { name: /actions for|More|Options/i }).first();
    await more.click(); await page.waitForTimeout(500);
    out.convMenu = await names(page, 'body');
    const del = page.getByRole('menuitem', { name: /Delete/i }).or(page.getByRole('button', { name: /^Delete/i })).first();
    out.deleteTitle = await del.getAttribute('title').catch(() => null);
    out.deleteDesc = await del.evaluate((n) => { const id = n.getAttribute('aria-describedby'); return id ? document.getElementById(id)?.textContent : null; }).catch(() => null);
    out.convText = (await page.locator('body').innerText()).slice(0, 2500);
  });
  writeFileSync(process.env.RVLX_OUT ?? 'pilot2.json', JSON.stringify(out, null, 1));
});
