import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from '../e2e/helpers';
import { record, shot, THEMES, useTheme, WIDTHS } from './vbkit';

/** Visual-review captures for S4-0102-06, S4-0104-01, S4-0107-01, S4-0108-04 and S4-0110-07. */

type Lanes = { vocals: number[]; drums: number[]; bass: number[]; other: number[] };
const half = (cells: number) => Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
const shapeOf = (cells: number) => {
  const row = half(cells);
  const lanes: Lanes = { vocals: row, drums: row, bass: row, other: row };
  return { a: lanes, b: lanes };
};

async function withStudio(page: Page, cells = 8) {
  const shape = shapeOf(cells);
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => (/\/mix\/1\/studio(\?|$)/.test(route.request().url())
    ? route.fulfill({ json: { status: 'ready', key: `vb-${cells}`, cells, seconds: 8, bars: cells * 2, start_shape: shape, shape } })
    : route.fallback()));
  await page.route('**/api/mix/1/options*', (route) => rewriteJson(route, (body) => ({ ...body, studio: { available: true } })));
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

async function openStudio(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click();
  await expect(page.locator('.studio-grid')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetMix(request, [1, 2, 3]);
});

test('S4-0102-06 Studio Apply pending, complete and failed', async ({ page }) => {
  for (const theme of THEMES) {
    await useTheme(page, theme);
    for (const width of WIDTHS) {
      for (const state of ['pending', 'failed', 'complete'] as const) {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.evaluate(() => { try { for (const key of Object.keys(localStorage)) if (key.includes('studio')) localStorage.removeItem(key); } catch { /* none */ } }).catch(() => undefined);
        await withStudio(page);
        const mix = await (await page.request.get('/api/mix')).json();
        await page.route('**/api/mix/1/studio/use*', async (route) => {
          if (state === 'pending') return; // held: the Apply never answers while we look
          if (state === 'failed') return route.fulfill({ status: 500, json: { detail: 'Synthetic failure: the shape could not be applied.' } });
          return route.fulfill({ json: mix });
        });
        await openStudio(page, width);
        await page.locator('.studio-cell[aria-pressed="false"]').first().click();
        const dirty = (await page.locator('.studio-save-state').textContent()) ?? '';
        await shot(page, 'S4-0102-06', `studio-dirty-${theme}-${width}`, page.locator('.studio'));
        await page.getByRole('button', { name: 'Apply to this transition' }).click();
        let words = '';
        if (state === 'pending') {
          await expect(page.locator('.studio-save-state')).toHaveText(/Applying your transition/);
          words = (await page.locator('.studio-save-state').textContent()) ?? '';
          await shot(page, 'S4-0102-06', `studio-pending-${theme}-${width}`, page.locator('.studio'));
        } else if (state === 'failed') {
          await expect(page.locator('.studio [role="alert"]').first()).toBeVisible();
          words = (await page.locator('.studio [role="alert"]').first().textContent()) ?? '';
          words += ` | ${await page.locator('.studio-save-state').textContent()}`;
          await shot(page, 'S4-0102-06', `studio-failed-${theme}-${width}`, page.locator('.studio'));
        } else {
          await expect(page.locator('.studio')).toHaveCount(0);
          words = (await page.locator('[role="status"], .toast').allTextContents()).join(' | ');
          await shot(page, 'S4-0102-06', `studio-complete-${theme}-${width}`);
        }
        record({ task: 'S4-0102-06', theme, width, state, dirty, words });
      }
    }
  }
});

const ready = { status: 'ready', key: 'vb', label: 'Word blend', style: 'word_blend', passed: true };
function link(a: number, b: number, titleA: string, titleB: string, phrase: string, worked = true) {
  return { phrase, kind: 'end-start', a, b, artist_a: 'Ada Reyes', title_a: titleA, artist_b: 'Bo Lindqvist', title_b: titleB, line_a: `we danced ${phrase}`, line_b: `${phrase} we sang`, moves: ['word_blend', 'word_cut'], move: 'word_blend', state: worked ? { ...ready, key: `vb-${a}-${b}` } : { status: 'failed', key: `vb-${a}-${b}`, label: 'Word blend', style: 'word_blend', passed: false, error: 'The words did not line up closely enough.' }, worked };
}

test('S4-0104-01 word-connection cards: multiple, zero and weak', async ({ page }) => {
  const sets = {
    multiple: [link(1, 2, 'Morning Light', 'Slow Tide', 'all night'), link(3, 4, 'Paper Moon', 'Neon Rain', 'hold on'), link(5, 6, 'שלום עולם', 'مرحبا بالعالم', 'the light')],
    zero: [],
    weak: [link(1, 2, 'Morning Light', 'Slow Tide', 'all night'), link(9, 10, 'Déjà Vu', 'Same Name', 'every time', false)],
  };
  for (const theme of THEMES) {
    await useTheme(page, theme);
    for (const width of WIDTHS) {
      for (const [name, links] of Object.entries(sets)) {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.route('**/api/links?**', (route) => route.fulfill({ json: { links, prepared: links.length, preparing: links.length } }));
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/discover');
        await expect(page.locator('main#main')).toBeVisible();
        if (name === 'weak') await page.locator('details.didnt summary').click();
        if (name === 'zero') await expect(page.getByText('No links yet')).toBeVisible();
        else await expect(page.locator('.link-card').first()).toBeVisible();
        const order = await page.locator('.link-card').first().evaluate((card) => {
          const top = (selector: string) => card.querySelector(selector)?.getBoundingClientRect().top ?? null;
          const controls = [...card.querySelectorAll('button, select')].map((element) => element.getBoundingClientRect().top);
          return { phrase: top('.link-phrase, blockquote, q'), from: top('.link-handoff'), firstControl: controls.length ? Math.min(...controls) : null };
        }).catch(() => null);
        await shot(page, 'S4-0104-01', `links-${name}-${theme}-${width}`, page.locator('main#main'));
        record({ task: 'S4-0104-01', theme, width, name, order });
      }
    }
  }
});

const JOBS = {
  worker: { running: true, rendering_the_mix: false },
  mix: { queued: 0, rendering: 0, failed: 0, none: 0, ready: 3 },
  drafts_in_line: 0, storage_full: false,
  analysis: { running: false, paused: false, asked_for: 0, left: 0 },
  failed_seams: [], failed_songs: [], estimates: '',
};

test('S4-0107-01 Workspace overview: storage full, nothing ready, offline', async ({ page }) => {
  const states: Record<string, (page: Page) => Promise<void>> = {
    'storage-full': (p) => p.route('**/api/jobs', (route) => route.fulfill({ json: { ...JOBS, storage_full: true, mix: { queued: 2, rendering: 0, failed: 0, none: 0, ready: 1 } } })),
    'no-ready': (p) => p.route('**/api/jobs', (route) => route.fulfill({ json: { ...JOBS, mix: { queued: 0, rendering: 1, failed: 0, none: 2, ready: 0 }, analysis: { running: true, paused: false, asked_for: 0, left: 9 } } })),
    offline: (p) => p.route('**/api/jobs', (route) => route.abort('connectionrefused')),
  };
  for (const theme of THEMES) {
    await useTheme(page, theme);
    for (const width of WIDTHS) {
      for (const [name, stub] of Object.entries(states)) {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await stub(page);
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/workshop');
        await expect(page.locator('main#main')).toBeVisible();
        await page.waitForTimeout(1500);
        const first = await page.locator('main#main').evaluate((main) => [...main.querySelectorAll('h2, h3, .needs-you li, [role="alert"], .warn')].slice(0, 6).map((element) => (element.textContent ?? '').trim().slice(0, 100)));
        await shot(page, 'S4-0107-01', `workspace-${name}-${theme}-${width}`, width === 1440 ? undefined : page.locator('main#main'));
        record({ task: 'S4-0107-01', theme, width, name, first });
      }
    }
  }
});

test('S4-0108-04 export job stages', async ({ page, request }) => {
  const mix = (await (await request.get('/api/mix')).json()).mix as { song_id: number; title: string; artist: string; seam?: { state: { key: string } } }[];
  const job = (state: string) => ({
    id: 'job-vb', state, scope: 'current', draft: null, mix_name: 'Synthetic evening mix', revision: 'rev-vb-synthetic',
    songs: mix.map((item) => ({ song_id: item.song_id, title: item.title, artist: item.artist })),
    seams: mix.slice(1).map((item, index) => ({ key: item.seam?.state.key ?? `seam-${index}`, from: mix[index].title, to: item.title })),
    seams_total: mix.length - 1, seams_ready: state === 'preparing' ? 1 : mix.length - 1, seconds_estimate: 600,
    name: 'synthetic-evening-mix.flac', seconds: state === 'ready' ? 598 : null,
    error: state === 'failed' ? 'The encoder stopped before the file was finished.' : null,
    created_at: 1_793_000_000, can_cancel: ['preparing', 'encoding'].includes(state), quiet_seconds: 0,
  });
  for (const theme of THEMES) {
    await useTheme(page, theme);
    for (const width of WIDTHS) {
      for (const state of ['preparing', 'encoding', 'ready', 'failed', 'cancelling', 'cancelled', 'interrupted', 'expired', 'mystery_state']) {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.route('**/api/exports/jobs', (route) => route.fulfill({ json: { jobs: [job(state)] } }));
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/workshop');
        const row = page.locator('.exports-list .export-job').first();
        await expect(row).toBeVisible();
        const facts = await row.evaluate((element) => ({ text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(), download: !!element.querySelector('a[download]'), percent: /\d+\s*%/.test(element.textContent ?? '') }));
        await shot(page, 'S4-0108-04', `export-${state}-${theme}-${width}`, row);
        record({ task: 'S4-0108-04', theme, width, state, ...facts });
      }
    }
  }
});

test('S4-0110-07 forced colours, focus visibility and target spacing', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme, reducedMotion: 'reduce' });
    for (const width of WIDTHS) {
      for (const path of ['/library', '/mix/current/edit', '/mixes', '/workshop']) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.locator('main#main')).toBeVisible();
        await page.waitForTimeout(800);
        // focus a control by keyboard so the ring is in the picture
        await page.locator('main#main').locator('button, a[href], input').first().focus();
        const focus = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          const style = getComputedStyle(element);
          return { tag: element.tagName, outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, boxShadow: style.boxShadow };
        });
        const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input, main select, nav button, nav a[href]')]
          .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden'; })
          .filter((element) => { const box = element.getBoundingClientRect(); return box.width < 24 || box.height < 24; })
          .map((element) => `${element.tagName.toLowerCase()}.${element.className} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}" ${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)}`));
        const slug = path.replace(/\W+/g, '-').replace(/^-|-$/g, '');
        await shot(page, 'S4-0110-07', `forced-${slug}-${scheme}-${width}`);
        record({ task: 'S4-0110-07', scheme, width, path, focus, under24: small });
      }
    }
  }
});
