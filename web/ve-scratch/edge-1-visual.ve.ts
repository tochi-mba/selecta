import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { covered, horizontalOverflow, out, ROUTES, save, setTheme, settle, sha } from './lib';

const WIDTHS = [
  { width: 320, height: 568 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 3840, height: 2160 },
] as const;

type Shot = { id: string; path: string; theme: string; width: number; height: number; file: string; sha256: string; overflow: number; covered: string[] };

test('routes and overlays paired in Light and Dark at 320, 768, 1440 and 3840', async ({ page }) => {
  const shots: Shot[] = [];
  for (const viewport of WIDTHS) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      const capture = async (id: string, path: string) => {
        await settle(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const file = out('visual', `${viewport.width}`, `${id}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: viewport.width < 3000, animations: 'disabled', caret: 'hide' });
        shots.push({ id, path, theme, ...viewport, file, sha256: sha(file), overflow: await horizontalOverflow(page), covered: await covered(page, 'main#main button, main#main a[href], main#main input') });
      };
      for (const route of ROUTES) {
        await page.goto(route.path);
        await capture(route.id, route.path);
      }
      await page.goto('/mix/current/edit');
      await page.getByRole('button', { name: 'Download audio' }).click();
      await expect(page.getByRole('dialog', { name: 'Save as an audio file' })).toBeVisible();
      await capture('export-dialog', '/mix/current/edit');
      await page.goto('/mixes');
      await page.getByRole('button', { name: 'Customize' }).click();
      await expect(page.getByRole('dialog', { name: 'Shape the next mix' })).toBeVisible();
      await capture('shape-dialog', '/mixes');
      await page.goto('/library');
      await page.getByRole('checkbox', { name: /^Select recording/ }).first().check();
      await capture('library-selection', '/library');
      await page.goto('/library?q=missing-fixture-song-xyz');
      await expect(page.getByText(/Nothing matches/)).toBeVisible();
      await capture('library-empty-search', '/library?q=missing-fixture-song-xyz');
      save('visual-manifest.json', shots);
    }
  }
});

type Driver = { id: string; drive(page: Page, request: APIRequestContext): Promise<void> };

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

const STATES: Driver[] = [
  {
    id: 'setup-first-run',
    async drive(page, request) {
      const status = await (await request.get('/api/status')).json();
      const empty = { ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 }, scan: { status: 'idle' } };
      await page.route('**/api/status', (route) => route.fulfill({ json: empty }));
      await page.goto('/');
      await expect(page.getByRole('textbox', { name: 'Music folder' })).toBeVisible();
    },
  },
  {
    id: 'library-failed',
    async drive(page) {
      await page.route('**/api/library?**', (route) => route.fulfill({ status: 500, json: { detail: 'synthetic failure' } }));
      await page.goto('/library');
      await expect(page.locator('.problem').first()).toBeVisible({ timeout: 30_000 });
    },
  },
  {
    id: 'offline',
    async drive(page) {
      await page.goto('/library');
      await expect(page.locator('main#main')).toBeVisible();
      await page.route('**/api/status', (route) => route.abort('connectionrefused'));
      await expect(page.locator('.connection')).toBeVisible({ timeout: 30_000 });
    },
  },
  { id: 'listen-playing', drive: (page) => play(page) },
  {
    id: 'stage',
    async drive(page) {
      await play(page);
      await page.locator('[data-stage-launcher]').evaluate((node) => {
        for (let up = node.parentElement; up; up = up.parentElement) if (up.tagName === 'DETAILS') (up as HTMLDetailsElement).open = true;
      });
      await page.locator('[data-stage-launcher]').click();
      await expect(page.locator('.stage-controls')).toBeVisible();
      await page.waitForTimeout(1500);
    },
  },
  { id: 'inspector', drive: (page) => inspector(page) },
  {
    id: 'studio',
    async drive(page) {
      await inspector(page);
      await page.getByRole('tab', { name: 'Studio', exact: true }).click();
      await page.getByRole('button', { name: 'Open the Studio' }).click();
      await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 90_000 });
    },
  },
  {
    id: 'requests-bridge',
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
      await expect(page.getByRole('dialog', { name: 'Requests' })).toBeVisible();
    },
  },
  {
    id: 'song-details',
    async drive(page) {
      await page.goto('/library');
      await page.getByRole('button', { name: /^Details for / }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
];

test('driven states paired in Light and Dark at 375x667 and 1440x900', async ({ page, request }) => {
  const shots: Record<string, unknown>[] = [];
  const failures: string[] = [];
  for (const viewport of [{ width: 375, height: 667 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const state of STATES) {
      for (const theme of ['light', 'dark'] as const) {
        try {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await setTheme(page, theme);
          await state.drive(page, request);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await page.waitForTimeout(300);
          const file = out('states', `${viewport.width}`, `${state.id}-${theme}.png`);
          await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
          shots.push({ id: state.id, theme, ...viewport, file, sha256: sha(file), overflow: await horizontalOverflow(page) });
        } catch (error) {
          failures.push(`${state.id} ${theme} ${viewport.width}: ${String(error).slice(0, 300)}`);
        }
        // stop anything the state started
        await page.goto('about:blank');
      }
      save('states-manifest.json', { shots, failures });
    }
  }
});
