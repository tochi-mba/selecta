/* LX lab performance manifest (code half of LX-0342-07, LX-0350-01, LX-0350-08 and LX-0365-07).
 * For a 100, 1,000 and 20,000-song library (served page by page like MP-0291-07) it times each
 * search from the input event to a stable result (the first row shows the new query and the count
 * has stayed put for five frames), and counts sounds started while browsing, which must be zero.
 * It writes manifest.json to SELECTA_LX_PERF_OUT (or this test's output folder) with the device
 * named by SELECTA_LX_DEVICE and SELECTA_LX_UNLOADED=1 only when the person running it says the
 * machine was otherwise idle. src/selecta/audit/lx_release_evidence.py perf_problems() refuses an
 * unnamed or loaded run, and thresholds() turns a valid one into release budgets. Numbers from a
 * busy shared laptop are noise: this spec records, it never asserts a time. */
import { expect, Page, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetMix, soundsStarted, spyOnAudio } from './helpers';

const SIZES = [100, 1000, 20_000];
const SAMPLES = Number(process.env.SELECTA_LX_SAMPLES ?? 7);

test.beforeEach(async ({ request }) => resetMix(request));

async function serveLibrary(page: Page, total: number) {
  let template: Record<string, unknown> | null = null;
  await page.unroute('**/api/library?**');
  await page.route('**/api/library?**', async (route) => {
    const url = new URL(route.request().url());
    if (!template) template = (await (await route.fetch()).json()).songs[0];
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const after = Number(url.searchParams.get('after') ?? 0);
    const q = url.searchParams.get('q') ?? '';
    const size = q ? Math.min(total, 40) : total;
    const songs = Array.from({ length: Math.max(0, Math.min(limit, size - after)) }, (_, index) => ({
      ...template, id: 100_000 + after + index,
      title: `${q ? `${q} ` : ''}Synthetic Recording ${after + index + 1}`, artist: `Artist ${(after + index) % 300}`,
    }));
    await route.fulfill({ json: { songs, total: size, next: after + limit < size ? String(after + limit) : null } });
  });
}

/** ms from the input event to the first row showing the query with the count still for 5 frames. */
const timeSearch = (page: Page, query: string) => page.evaluate((text) => new Promise<number>((done, fail) => {
  const box = document.querySelector<HTMLInputElement>('main input[type=search]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  const started = performance.now();
  setter.call(box, text);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  let last = '';
  let still = 0;
  const check = () => {
    const first = document.querySelector('ul.library-rows > li')?.textContent ?? '';
    const count = document.querySelector('.library-count')?.textContent ?? '';
    if (first.includes(text)) {
      still = count === last ? still + 1 : 0;
      last = count;
      if (still >= 5) return done(performance.now() - started);
    }
    if (performance.now() - started > 30_000) return fail(new Error(`no stable result for ${text}`));
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}), query);

test('LX perf baseline: input to stable result at 100, 1,000 and 20,000 songs, and no unsolicited sound', async ({ page, browserName, browser }) => {
  test.setTimeout(600_000);
  await spyOnAudio(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const runs: { songs: number; input_to_stable_ms: number[] }[] = [];
  for (const total of SIZES) {
    await serveLibrary(page, total);
    await page.goto('/library');
    await expect(page.locator('.library-count')).toContainText(String(total));
    const samples: number[] = [];
    for (let n = 0; n < SAMPLES; n += 1) {
      samples.push(Math.round(await timeSearch(page, `q${total}x${n}`) * 10) / 10);
    }
    runs.push({ songs: total, input_to_stable_ms: samples });
  }
  const unsolicited = await soundsStarted(page);
  const manifest = {
    programme: 'LX', date: new Date().toISOString().slice(0, 10),
    device: { name: process.env.SELECTA_LX_DEVICE ?? '', unloaded: process.env.SELECTA_LX_UNLOADED === '1' },
    browser: `${browserName} ${browser.version()}`, viewport: '1440x900', samples_per_size: SAMPLES,
    runs, unsolicited_sounds: unsolicited,
  };
  const out = process.env.SELECTA_LX_PERF_OUT ?? test.info().outputPath('lx-perf');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  expect(runs.map((run) => run.input_to_stable_ms.length)).toEqual(SIZES.map(() => SAMPLES));
  expect(unsolicited, 'browsing and searching the Library starts no sound').toBe(0);
});
