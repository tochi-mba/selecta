/* LX review screenshot set (code half of LX-0340-08, LX-0352-08, LX-0364-03, LX-0364-08 and
 * LX-0365-06). Captures the Library and Lucy routes in light and dark, at 320 and 1440px, in each
 * Library state and density, plus 400% zoom (a 1280px window at 400% is a 320px layout at 4x), and
 * writes manifest.json with blank reviewer, date and verdict fields. A person reviews the shots and
 * fills those in; src/selecta/audit/lx_release_evidence.py review_problems() refuses the manifest
 * until every shot is signed. Output goes to SELECTA_LX_SHOTS, or this test's output folder. */
import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetMix } from './helpers';

type Shot = {
  file: string; route: 'library' | 'lucy'; state: string; theme: 'light' | 'dark'; width: number;
  zoom: number; reviewer: string; review_date: string; verdict: string;
};

test.beforeEach(async ({ request }) => {
  await resetMix(request);
  await request.put('/api/lucy/settings', { data: { enabled: true } });
});

async function proposal(request: APIRequestContext): Promise<string> {
  const made = await (await request.post('/api/lucy/conversations', { data: { title: 'LX review' } })).json();
  const sent = await request.post(`/api/lucy/conversations/${made.id}/turns`, {
    data: { client_id: `lx-shots-${Date.now()}`, text: 'make me 6 songs', expected_revision: null },
  });
  expect(sent.ok()).toBe(true);
  await expect.poll(async () => {
    const snap = await (await request.get(`/api/lucy/conversations/${made.id}`)).json();
    return snap.messages.some((m: { role: string; status: string }) => m.role === 'assistant' && m.status === 'complete');
  }, { timeout: 60_000 }).toBe(true);
  return made.id;
}

const LIBRARY_STATES: { state: string; address: string; density?: 'Comfortable' | 'Compact'; layout?: string }[] = [
  { state: 'everything', address: '/library' },
  { state: 'compact', address: '/library', density: 'Compact' },
  { state: 'cards', address: '/library', layout: 'Card view' },
  { state: 'needs-attention', address: '/library?show=attention' },
  { state: 'no-match', address: '/library?q=zzzz-no-such-song' },
  { state: 'song-sheet', address: '/library?song=10' },
];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

test('LX review shots: Library and Lucy, both themes, 320 and 1440px, states, densities and 400% zoom', async ({ browser, request }) => {
  test.setTimeout(600_000);
  const out = process.env.SELECTA_LX_SHOTS ?? test.info().outputPath('lx-review-shots');
  mkdirSync(out, { recursive: true });
  const lucy = await proposal(request);
  const shots: Shot[] = [];
  const take = async (page: Page, shot: Omit<Shot, 'file' | 'reviewer' | 'review_date' | 'verdict'>) => {
    const file = `${shot.route}-${shot.state}-${shot.theme}-${shot.width}${shot.zoom > 1 ? '-zoom400' : ''}.png`;
    await settle(page);
    await page.screenshot({ path: join(out, file), fullPage: true });
    shots.push({ ...shot, file, reviewer: '', review_date: '', verdict: '' });
  };
  for (const theme of ['light', 'dark'] as const) {
    for (const [width, zoom] of [[320, 1], [1440, 1], [320, 4]] as const) {
      const context = await browser.newContext({
        viewport: { width, height: zoom > 1 ? 256 : 900 }, deviceScaleFactor: zoom, colorScheme: theme,
      });
      const page = await context.newPage();
      for (const entry of LIBRARY_STATES) {
        if (entry.density && width < 768) continue; // Compact is a desktop-only density (ADR-0351)
        await page.goto(entry.address);
        await expect(page.locator('main h1')).toBeVisible();
        if (entry.density) await page.getByRole('button', { name: entry.density }).click();
        if (entry.layout) await page.getByRole('button', { name: entry.layout }).click();
        await take(page, { route: 'library', state: entry.state, theme, width, zoom });
        if (entry.density) await page.getByRole('button', { name: 'Comfortable' }).click();
        if (entry.layout) await page.getByRole('button', { name: 'List view' }).click();
      }
      await page.goto('/mixes');
      await expect(page.getByRole('link', { name: 'Plan a mix with Lucy' })).toBeVisible();
      await take(page, { route: 'lucy', state: 'ways-in', theme, width, zoom });
      await page.goto(`/mixes/lucy/${lucy}`);
      await expect(page.locator('main')).toBeVisible();
      await take(page, { route: 'lucy', state: 'proposal', theme, width, zoom });
      await context.close();
    }
  }
  const manifest = {
    status: 'candidate-not-independently-verified',
    programme: 'LX', made: new Date().toISOString().slice(0, 10), fixture: 'tests/e2e_server.py',
    zoom_400: shots.some((shot) => shot.zoom === 4), shots,
    // filled in by people: screen-reader sessions and real-device screenshots
    assistive: [] as { reader: string; reviewer: string; date: string }[],
    devices: [] as { device: string; file: string }[],
  };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  expect(shots.length).toBeGreaterThanOrEqual(2 * 3 * 7);
  for (const route of ['library', 'lucy']) {
    for (const theme of ['light', 'dark']) {
      for (const width of [320, 1440]) {
        expect(shots.some((s) => s.route === route && s.theme === theme && s.width === width), `${route} ${theme} ${width}`).toBe(true);
      }
    }
  }
});
