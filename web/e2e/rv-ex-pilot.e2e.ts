import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resetMix } from './helpers';

// Temporary pilot walkthrough (preparation only): does each study card's path exist at this SHA?
const out: Record<string, string> = {};
const OUT = process.env.RV_OUT ?? 'rv-ex-pilot.json';
const SHOTS = '../docs/verification/claude-checks/ex';
const note = (id: string, text: string) => { out[id] = (out[id] ? `${out[id]}; ` : '') + text; };

async function still(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
}

test.afterAll(() => writeFileSync(OUT, JSON.stringify(out, null, 2)));

test('EX-0118-01 cards in both themes at phone and desktop widths', async ({ browser }) => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
      await still(page, theme);
      await page.goto('/mixes');
      const card = page.locator('article.vibe-card').first();
      await expect(card).toBeVisible();
      await page.locator('.cards').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/ex-0118-01-cards-${theme}-${width}.png` });
      const buttons = await card.getByRole('button').allInnerTexts();
      const facts = await card.locator('.vibe-card-facts').getAttribute('aria-label');
      note('EX-0118-01', `${theme} ${width}: buttons [${buttons.map((b) => b.trim()).join(' | ')}], facts "${facts}"`);
      await page.close();
    }
  }
});

test('pilot walkthrough of the study card paths', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetMix(request);

  // EX-0115-01 / EX-0114-01: the five destinations from the first screen
  await page.goto('/');
  for (const label of ['Listen', 'Make a Mix', 'My Mixes', 'Library', 'Workspace']) {
    const link = page.getByRole('link', { name: label, exact: true }).first();
    note('EX-0115-01', `${label}: ${(await link.count()) ? 'in navigation' : 'MISSING'}`);
  }

  // EX-0117-01 / EX-0118-01: Play and Shape first on a card, nothing playing
  await page.goto('/mixes');
  const card = page.locator('article.vibe-card').first();
  note('EX-0117-01', `first card "${(await card.locator('h3, h4').first().innerText()).trim()}" offers Play: ${await card.getByRole('button', { name: 'Play', exact: true }).count()}, Shape first: ${await card.getByRole('button', { name: 'Shape first' }).count()}`);

  // EX-0116-01 / EX-0114-01: Listen plays, names the song and what is next
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 60_000 });
  const upNext = await page.getByText(/up next/i).first().isVisible().catch(() => false);
  note('EX-0116-01', `Play turned to Pause; Up Next visible: ${upNext}`);
  await play.click();
  await expect(play).toHaveText('Play', { timeout: 20_000 });
  note('EX-0116-01', 'Pause returned to Play');

  // EX-0124-02: the Requests drawer opens from Listen
  await page.getByRole('button', { name: /^Requests/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Requests' });
  note('EX-0124-02', `Requests drawer opens: ${await drawer.isVisible()}`);
  await page.keyboard.press('Escape');

  // EX-0119-01: current mix, drafts and the render line on My Mixes
  const made = await (await request.post('/api/drafts', { data: { name: 'Pilot later' } })).json();
  await request.post(`/api/mix/songs?draft=${made.id}`, { data: { song_id: 3 } });
  await page.goto('/mixes/mine');
  await expect(page.locator('.draft-list .draft').first()).toBeVisible();
  note('EX-0119-01', `drafts section: ${await page.getByRole('region', { name: 'Your drafts' }).count()}, render line: ${await page.getByRole('region', { name: 'Render line' }).count()}, draft "Pilot later" shown: ${await page.getByText('Pilot later').first().isVisible()}`);
  await request.delete(`/api/drafts/${made.id}`);

  // EX-0120-01: a 2-song mix shows song rows and a separate transition in the editor
  await resetMix(request, [1, 2]);
  await page.goto('/mix/current/edit');
  await page.waitForLoadState('networkidle');
  const change = await page.getByRole('button', { name: 'Change', exact: true }).count();
  note('EX-0120-01', `2-song mix: transition Change controls ${change}`);

  // EX-0122-02: the Studio path (stems seeded only with SELECTA_E2E_STEMS=1)
  if (change) {
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    const studio = page.getByRole('tab', { name: 'Studio' });
    note('EX-0122-02', `Studio tab: ${await studio.count()}`);
    if (await studio.count()) {
      await studio.click();
      const open = page.getByRole('button', { name: 'Open the Studio' });
      if (await open.count()) {
        await open.click();
        await page.waitForTimeout(3000);
        note('EX-0122-02', `Use throughout ${await page.getByRole('button', { name: 'Use throughout' }).count()}, Leave out ${await page.getByRole('button', { name: 'Leave out' }).count()}`);
      } else note('EX-0122-02', 'Open the Studio missing');
    }
  }

  // EX-0128-01: Workspace overview lists what needs you (analysis paused with SELECTA_E2E_BULK)
  await page.goto('/workshop');
  const needs = page.getByRole('heading', { name: 'What needs you' });
  await expect(needs).toBeVisible();
  const items = await page.locator('.needs-you-list li').allInnerTexts();
  note('EX-0128-01', `What needs you: ${items.map((t) => t.replace(/\s+/g, ' ').trim()).join(' / ') || 'nothing listed'}`);

  // EX-0126-01: first run refuses a file address and advises the folder (status mocked empty)
  const status = await (await request.get('/api/status')).json();
  await page.route('**/api/status', (route) => route.fulfill({ json: { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 }, scan: { status: 'idle' } } }));
  await page.goto('/');
  const field = page.getByRole('textbox').first();
  await field.fill('C:\\Windows\\win.ini');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForTimeout(2500);
  const advice = await page.getByText(/That’s a file|folder/).allInnerTexts();
  note('EX-0126-01', `after a file address: ${advice.slice(0, 2).map((t) => t.replace(/\s+/g, ' ').trim()).join(' / ')}`);
});
