import { APIRequestContext, Page, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const out: Record<string, unknown> = {};

async function dump(page: Page, key: string, note = '') {
  await page.waitForTimeout(600);
  const data = await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement | null;
    const visible = (n: Element) => { const r = (n as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const controls = [...document.querySelectorAll('main button, main a, main [role=tab], main [role=menuitem], main summary, [role=menu] [role=menuitem], dialog button')]
      .filter(visible)
      .map((n) => (n.getAttribute('aria-label') || (n as HTMLElement).innerText || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    return { text: (main?.innerText ?? '').slice(0, 2500), controls: [...new Set(controls)].slice(0, 80) };
  });
  out[key] = { note, ...data };
}

async function step(key: string, fn: () => Promise<void>) {
  try { await fn(); } catch (error) { out[`${key}:error`] = String(error).slice(0, 300); }
}

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

const lib = async (page: Page, address = '/library') => { await page.goto(address); await page.locator('.library-count').waitFor(); };
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search your library' });
const chip = (page: Page, name: RegExp) => page.locator('.library-filters').getByRole('button', { name }).first();
const row = (page: Page, title: string) => page.locator('ul.library-rows > li').filter({ hasText: title }).first();

test('pilot walkthrough of the LX study cards', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await step('library', async () => { await lib(page); await dump(page, 'library'); });
  await step('same-name', async () => { await lib(page); await search(page).fill('Same Name'); await dump(page, 'same-name'); });
  await step('needs', async () => { await lib(page); await chip(page, /Needs attention/i).click(); await dump(page, 'needs'); });
  await step('needs-more', async () => {
    await row(page, '').getByRole('button', { name: /More/i }).first().click(); await dump(page, 'needs-more');
    await page.keyboard.press('Escape');
  });
  await step('zzqx', async () => { await lib(page); await chip(page, /Needs attention/i).click(); await search(page).fill('zzqx'); await dump(page, 'zzqx'); });
  await step('zzqx-clear', async () => { await page.getByRole('button', { name: /Clear search/i }).first().click(); await dump(page, 'zzqx-clear'); });
  await step('ready', async () => { await lib(page); await chip(page, /^Ready/i).click(); await dump(page, 'ready'); });
  await step('setaside', async () => { await lib(page); await chip(page, /Set aside/i).click(); await dump(page, 'setaside'); });
  await step('ready-episode', async () => { await lib(page); await chip(page, /^Ready/i).click(); await search(page).fill('Episode'); await dump(page, 'ready-episode'); });
  await step('lastcall-more', async () => {
    await lib(page); const r = row(page, 'Last Call');
    out['lastcall-row'] = await r.innerText();
    await r.getByRole('button', { name: /More/i }).first().click(); await dump(page, 'lastcall-more');
    await page.keyboard.press('Escape');
  });
  await step('cards', async () => { await lib(page); await page.getByRole('button', { name: 'Card view' }).click(); await dump(page, 'cards'); });
  await step('list', async () => { await page.getByRole('button', { name: 'List view' }).click(); });
  await step('song11', async () => { await lib(page, '/library?song=11'); await dump(page, 'song11'); });
  await step('song11-dialog', async () => {
    out['song11-sheet'] = await page.locator('dialog, [role=dialog], .song-sheet').first().innerText();
    const adv = page.locator('summary').filter({ hasText: /advanced|more detail|file/i }).first();
    await adv.click(); out['song11-advanced'] = await page.locator('dialog, [role=dialog], .song-sheet').first().innerText();
  });
  await step('song11-tempo', async () => {
    await page.getByRole('button', { name: /tempo|correct/i }).first().click();
    out['song11-correct'] = await page.locator('dialog, [role=dialog], .song-sheet').first().innerText();
  });
  await request.put('/api/lucy/settings', { data: { enabled: true } });
  await step('mixes', async () => { await page.goto('/mixes'); await page.locator('main').waitFor(); await dump(page, 'mixes');
    out['mixes-card'] = await page.locator('article.vibe-card').first().innerText(); });
  await step('lucy-new', async () => { const id = await convo(request, []); await page.goto(`/mixes/lucy/${id}`); await page.getByRole('textbox', { name: 'Message to Lucy' }).waitFor(); await dump(page, 'lucy-new'); });
  await step('lucy-6', async () => { const id = await convo(request, ['make me 6 songs']); await page.goto(`/mixes/lucy/${id}`); await page.waitForTimeout(1500); await dump(page, 'lucy-6');
    await page.getByRole('tab', { name: /Your mix/i }).first().click(); await dump(page, 'lucy-6-yourmix');
    await page.getByRole('tab', { name: /Conversations/i }).first().click(); await dump(page, 'lucy-6-convs');
    await page.getByRole('button', { name: /More|actions|Options/i }).first().click().catch(() => undefined); await dump(page, 'lucy-6-convs-menu'); });
  await step('lucy-critique', async () => { const id = await convo(request, ['make me 6 songs', 'keep Morning Light and make it calmer']); await page.goto(`/mixes/lucy/${id}`); await page.waitForTimeout(1500); await dump(page, 'lucy-critique'); });
  writeFileSync(process.env.RVLX_OUT ?? 'pilot.json', JSON.stringify(out, null, 1));
});
