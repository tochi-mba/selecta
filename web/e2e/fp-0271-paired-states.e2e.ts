import { writeFileSync } from 'node:fs';
import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { resetMix } from './helpers';
import { assertNoPersonalData, controlSemantics, provenance, sha256 } from './pairedEvidence';

/**
 * FP-0271-01/02/04/05: the critical states that need driving (Setup, playing, Stage, Inspector, Studio,
 * Requests, Details and two failures), each captured in Light and in Dark at the same viewport, from the
 * same synthetic library and the same state. paired-theme.e2e.ts pairs the routes that load by address.
 * The Dark capture's control roles, labels and states must equal the Light capture's. These are
 * CANDIDATES for a named person to review (FP-0271-06), not approved goldens.
 */

type Driver = { id: string; mp: string; root: string; clock?: boolean; drive(page: Page, request: APIRequestContext): Promise<void> };

const openAncestors = (page: Page, selector: string) => page.locator(selector).evaluate((node) => {
  for (let up = node.parentElement; up; up = up.parentElement) if (up.tagName === 'DETAILS') (up as HTMLDetailsElement).open = true;
});

async function play(page: Page) {
  await page.goto('/listen');
  const button = page.locator('.now .transport .primary');
  await button.click();
  await expect(button).toHaveText('Pause', { timeout: 30_000 });
}

async function inspector(page: Page) {
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await expect(page.locator('.edit-inspector, .overlay-sheet').first()).toBeVisible();
}

/** FP-0271-01: the fixture IDs; `mp` is the matching MP-0272 fixture in docs/adr/mp-0272-surface-inventory.json */
const STATES: Driver[] = [
  {
    id: 'setup-first-run', mp: 'fx.route.idle', root: 'main#main',
    async drive(page, request) {
      const status = await (await request.get('/api/status')).json();
      const empty = { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 }, scan: { status: 'idle' } };
      await page.route('**/api/status', (route) => route.fulfill({ json: empty }));
      await page.goto('/');
      await expect(page.getByRole('textbox', { name: 'Music folder' })).toBeVisible();
    },
  },
  {
    id: 'library-failed', mp: 'fx.fail.library', root: 'main#main',
    async drive(page) {
      await page.route('**/api/library?**', (route) => route.fulfill({ status: 500, json: { detail: 'synthetic failure for FP-0271' } }));
      await page.goto('/library');
      await expect(page.locator('.problem').first()).toBeVisible({ timeout: 30_000 });
    },
  },
  {
    id: 'offline', mp: 'fx.fail.offline', root: 'body',
    async drive(page) {
      await page.goto('/library');
      await expect(page.locator('main#main')).toBeVisible();
      await page.route('**/api/status', (route) => route.abort('connectionrefused'));
      await expect(page.locator('.connection')).toBeVisible({ timeout: 30_000 });
    },
  },
  { id: 'listen-playing', mp: 'fx.listen.playing', root: 'main#main', clock: true, drive: (page) => play(page) },
  {
    id: 'stage', mp: 'fx.stage', root: 'body', clock: true,
    async drive(page) {
      await play(page);
      await openAncestors(page, '[data-stage-launcher]');
      await page.locator('[data-stage-launcher]').click();
      await expect(page.locator('.stage-controls')).toBeVisible();
    },
  },
  { id: 'inspector', mp: 'fx.edit.inspector', root: 'body', drive: (page) => inspector(page) },
  {
    id: 'studio', mp: 'fx.studio', root: 'body',
    async drive(page) {
      await inspector(page);
      await page.getByRole('tab', { name: 'Studio', exact: true }).or(page.getByRole('button', { name: 'Studio', exact: true })).first().click();
      // stems are set to never in tests/e2e_server.py, so the Studio says why it cannot open
      await expect(page.getByRole('button', { name: 'Open the Studio' }).or(page.locator('.warn').filter({ hasText: /stem|Studio/i })).first()).toBeVisible();
    },
  },
  {
    id: 'requests-bridge', mp: 'fx.requests.bridge', root: '.overlay-panel',
    async drive(page, request) {
      const mix = (await (await request.get('/api/mix')).json()).mix as { song_id: number; title: string; artist: string }[];
      const [first, second, third, fourth] = mix.map((item) => ({ id: item.song_id, title: item.title, artist: item.artist }));
      const rows = [
        {
          id: 901, song_id: fourth.id, title: fourth.title, artist: fourth.artist, status: 'pending', available: 1,
          stage: 'approve', needs_approval: true, bridge_choice: null, after: first.title, after_id: first.id,
          route: [{ ...third }, { ...fourth }],
          transitions: [{ from: first.title, to: third.title, key: 'a', status: 'waiting' }, { from: third.title, to: fourth.title, key: 'b', status: 'waiting' }],
        },
        { id: 902, song_id: second.id, title: second.title, artist: second.artist, status: 'pending', available: 1, stage: 'waiting', waiting_on: first.title, seconds: 95 },
      ];
      await page.route('**/api/requests', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { requests: rows } }) : route.continue()));
      await page.goto('/listen');
      await page.getByRole('button', { name: /^Requests/ }).first().click();
      await expect(page.getByRole('dialog', { name: 'Requests' })).toContainText(fourth.title);
    },
  },
  {
    id: 'song-details', mp: 'fx.overlay.song_details', root: '.overlay-panel',
    async drive(page) {
      await page.goto('/library');
      await page.getByRole('button', { name: /^Details for / }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
];

const VIEWPORTS = [{ width: 375, height: 667 }, { width: 1280, height: 800 }] as const;

test.beforeEach(async ({ request }) => resetMix(request));

for (const viewport of VIEWPORTS) {
  test(`driven states paired in Light and Dark at ${viewport.width}x${viewport.height} (FP-0271-02/04)`, async ({ page, request }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const candidates: Array<{ id: string; mp: string; theme: string; width: number; height: number; semanticSha256: string; screenshot: string }> = [];
    for (const state of STATES) {
      const seen = new Map<string, string>();
      for (const theme of ['light', 'dark'] as const) {
        await resetMix(request);
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/mixes');
        await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' })), theme);
        await state.drive(page, request);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.waitForTimeout(180);
        const semanticSha256 = sha256(await controlSemantics(page, state.root, state.clock));
        seen.set(theme, semanticSha256);
        const screenshot = `candidate-${viewport.width}x${viewport.height}-${state.id}-${theme}.png`;
        await page.screenshot({ path: info.outputPath(screenshot), animations: 'disabled', caret: 'hide' });
        candidates.push({ id: state.id, mp: state.mp, theme, ...viewport, semanticSha256, screenshot });
      }
      expect(seen.get('dark'), `${state.id}: the theme changed a control's role, label or state at ${viewport.width}px`).toBe(seen.get('light'));
    }
    const required = STATES.length * 2;
    expect(candidates).toHaveLength(required);
    const manifest = JSON.stringify({
      status: 'candidate-not-independently-verified',
      ...provenance(),
      capturedAt: new Date().toISOString(),
      browser: 'msedge', motion: 'still/reduced', fixture: 'tests/e2e_server.py',
      required, captured: candidates.length, candidates,
    }, null, 2);
    assertNoPersonalData(manifest);
    writeFileSync(info.outputPath(`paired-states-manifest-${viewport.width}x${viewport.height}.json`), manifest);
  });
}
