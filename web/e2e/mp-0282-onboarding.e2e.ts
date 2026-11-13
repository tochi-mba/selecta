import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * ADR-282 first run, folder setup and readiness, measured from the real stylesheet in Edge. The first
 * run is the real server with its status counts answered as if nothing had been added yet (as
 * finishing.e2e.ts does), so the rest of the app stays real. Candidates for an independent reviewer.
 */
type Status = Record<string, unknown> & { counts: Record<string, number> };

async function realStatus(page: Page): Promise<Status> {
  return (await page.request.get('/api/status')).json();
}

/** Answer /api/status with whatever `answer()` says now, so a test can move the server along. */
async function statusFrom(page: Page, answer: () => Status) {
  await page.route('**/api/status', (route: Route) => route.fulfill({ json: answer() }));
}

const firstRun = (status: Status, more: Record<string, unknown> = {}): Status => ({ ...status, counts: { ...status.counts, total: 0, music: 0, analysed: 0, ready: 0 }, scan: { status: 'idle' }, ...more });
const preparing = (status: Status, counts: Record<string, number>, more: Record<string, unknown> = {}): Status => ({ ...status, counts: { ...status.counts, total: counts.music, ...counts }, scan: { status: 'idle' }, ...more });

async function at(page: Page, width: number, route = '/', height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

function startParts() {
  const box = (element: Element | null) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, size: parseFloat(getComputedStyle(element).fontSize) };
  };
  const main = document.querySelector('main#main')!;
  return {
    steps: box(main.querySelector('.setup-steps')),
    title: box(main.querySelector('h1')),
    lede: box(main.querySelector('.lede')),
    label: box(main.querySelector('.field label')),
    input: box(main.querySelector('.field input')),
    start: box(main.querySelector('.field button')),
    help: box(main.querySelector('.field .field-help')),
    error: box(main.querySelector('.field .warn')),
    advice: box(main.querySelector('form > .hint')),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
}
type Box = NonNullable<ReturnType<typeof startParts>['title']>;

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0282-01 the steps, title, explanation, folder field and Start read in one clear sequence', async ({ page }, info) => {
  const status = await realStatus(page);
  await statusFrom(page, () => firstRun(status));
  const readings = [];
  for (const width of [320, 768, 1440]) {
    await at(page, width);
    const found = await page.evaluate(startParts);
    const where = `${width}px`;
    const order = [found.steps, found.title, found.lede, found.label, found.input] as Box[];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index].top, `${where}: step ${index} is not below the one before`).toBeGreaterThanOrEqual(order[index - 1].bottom - 0.5);
    }
    // the title outranks the explanation, which is no smaller than the field's label
    expect(found.title!.size, `${where}: title size`).toBeGreaterThan(found.lede!.size * 1.5);
    expect(found.lede!.size, `${where}: explanation smaller than the label`).toBeGreaterThanOrEqual(found.label!.size);
    // Start sits with the folder it acts on: on its line, or straight under it on the same edge
    const beside = Math.abs((found.start!.top + found.start!.bottom) / 2 - (found.input!.top + found.input!.bottom) / 2) <= 1;
    const under = Math.abs(found.start!.left - found.input!.left) <= 1 && found.start!.top >= found.input!.bottom;
    expect(beside || under, `${where}: Start is away from the field`).toBe(true);
    if (beside) expect(Math.abs(found.start!.height - found.input!.height), `${where}: Start and field heights`).toBeLessThanOrEqual(1);
    expect(found.start!.height, `${where}: Start target`).toBeGreaterThanOrEqual(44);
    expect(Math.abs(found.title!.left - found.label!.left), `${where}: title and label start apart`).toBeLessThanOrEqual(1);
    expect(found.overflow, `${where}: scrolls sideways`).toBeLessThanOrEqual(0);
    // the decision is above the fold on a laptop and on a phone
    expect(found.start!.bottom, `${where}: Start below the first screen`).toBeLessThanOrEqual(900);
    readings.push({ width, ...found });
  }
  await expect(page.locator('.field button')).toHaveClass(/primary/);
  writeFileSync(info.outputPath('mp-0282-01-first-run.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0282-02 a long path, its label, an error and Start stay aligned, and the typing is kept', async ({ page }) => {
  const status = await realStatus(page);
  await statusFrom(page, () => firstRun(status));
  const long = 'D:\\Music\\Archive\\Vinyl rips 2009 to 2014\\Northern soul and rare groove\\Collected from the record shop on the corner\\Disc 4 of 9';
  await page.route('**/api/folders/check*', (route) => route.fulfill({ json: { ok: false, kind: 'missing', reason: 'That folder isn’t there.' } }));
  for (const width of [320, 768, 1440]) {
    await at(page, width);
    const box = page.getByRole('textbox', { name: 'Music folder' });
    await box.fill(long);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'That folder isn’t there.' })).toBeVisible();
    await expect(box, `${width}px: the typed path was thrown away`).toHaveValue(long);
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    const described = (await box.getAttribute('aria-describedby')) ?? '';
    const errorId = await page.locator('.field .warn').getAttribute('id');
    expect(described.split(' '), `${width}px: error not tied to the field`).toContain(errorId);
    const found = await page.evaluate(startParts);
    const where = `${width}px`;
    expect(found.overflow, `${where}: a long path pushes the page sideways`).toBeLessThanOrEqual(0);
    for (const [name, part] of [['label', found.label], ['help', found.help], ['error', found.error]] as const) {
      expect(Math.abs(part!.left - found.input!.left), `${where}: ${name} off the field’s edge`).toBeLessThanOrEqual(1);
    }
    expect(found.error!.top, `${where}: error above the field`).toBeGreaterThanOrEqual(found.input!.bottom);
    expect(found.start!.right, `${where}: Start pushed off`).toBeLessThanOrEqual(width);
    // the path scrolls inside its box rather than stretching it
    expect(await box.evaluate((input) => input.scrollWidth > input.clientWidth)).toBe(true);
    // editing after an error keeps going from what was typed
    await box.press('End');
    await box.type('0');
    await expect(box).toHaveValue(`${long}0`);
  }
});

test('MP-0282-03 what stays on this PC and what goes to LRCLIB is said beside the decision, before anything is sent', async ({ page }) => {
  const status = await realStatus(page);
  await statusFrom(page, () => firstRun(status));
  const away: string[] = [];
  page.on('request', (sent) => { if (!sent.url().startsWith('http://127.0.0.1')) away.push(sent.url()); });
  for (const width of [320, 1440]) {
    await at(page, width);
    const found = await page.evaluate(() => {
      const lede = document.querySelector('main#main .lede')!;
      const input = document.querySelector('main#main .field input')!.getBoundingClientRect();
      const start = document.querySelector('main#main .field button')!;
      return { text: lede.textContent ?? '', gap: input.top - lede.getBoundingClientRect().bottom, before: !!(lede.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    expect(found.text).toMatch(/original files are never moved or changed/);
    expect(found.text).toMatch(/artist, title, album and duration are sent to LRCLIB/);
    expect(found.before, 'disclosure comes before Start').toBe(true);
    // one short step from the field: the label and its help, no more
    expect(found.gap, `${width}px: disclosure far from the decision`).toBeLessThanOrEqual(96);
  }
  expect(away).toEqual([]);
});

test('MP-0282-04 stage counters and readiness hold still as the numbers change', async ({ page }) => {
  const status = await realStatus(page);
  let counts = { music: 7, analysed: 3, ready: 1 };
  await statusFrom(page, () => preparing(status, counts, { analysis_running: true }));
  for (const width of [320, 1440]) {
    counts = { music: 7, analysed: 3, ready: 1 };
    await at(page, width, '/mixes');
    await expect(page.locator('.setup-steps li[aria-current="step"]')).toContainText('Prepare library');
    const measure = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.readiness-steps li')].map((item) => {
      const value = item.querySelector('strong')!.getBoundingClientRect();
      const row = item.getBoundingClientRect();
      return { label: item.querySelector('span')!.textContent, top: row.top, height: row.height, valueRight: value.right, numeric: getComputedStyle(item.querySelector('strong')!).fontVariantNumeric };
    }));
    const before = await measure();
    expect(before.length).toBeGreaterThanOrEqual(3);
    for (const next of [{ music: 1288, analysed: 977, ready: 5 }, { music: 1288, analysed: 1111, ready: 5 }]) {
      counts = next;
      await page.reload();
      await expect(page.locator('.readiness-steps strong').first()).toHaveText(String(next.music));
      const after = await measure();
      for (const [index, row] of after.entries()) {
        expect(row.numeric, `${row.label} digits are not tabular`).toContain('tabular-nums');
        expect(Math.abs(row.top - before[index].top), `${width}px: ${row.label} row moved`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.height - before[index].height), `${width}px: ${row.label} row height`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.valueRight - before[index].valueRight), `${width}px: ${row.label} number’s edge moved`).toBeLessThanOrEqual(0.5);
      }
    }
  }
});

test('MP-0282-05 slow reading and slow analysis look like waiting, never like failure or a finish', async ({ page }) => {
  const status = await realStatus(page);
  let answer = firstRun(status, { scan: { status: 'running', folder: 'D:\\Music' } });
  await statusFrom(page, () => answer);
  await at(page, 375);
  const waiting = page.getByRole('status').filter({ hasText: 'Finding music in your folder' });
  await expect(waiting).toBeVisible();
  // a long wait: several polls later nothing has changed its story
  await page.waitForTimeout(3_500);
  await expect(waiting).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('main#main .warn')).toHaveCount(0);
  await expect(page.locator('main#main')).not.toContainText(/fail|error|couldn’t|done|finished|complete|ready to/i);
  await expect(page.getByRole('button', { name: 'Reading…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stop reading this folder' })).toBeEnabled();

  // the second stage, with analysis slowly running
  answer = preparing(status, { music: 40, analysed: 3, ready: 1 }, { analysis_running: true, scan: { status: 'running', folder: 'D:\\Music' } });
  await page.goto('/mixes');
  await expect(page.getByText('Analysing now')).toBeVisible();
  await page.waitForTimeout(2_500);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Still reading your folder' })).toBeVisible();
  // it never claims the library is ready, nor offers the first mix early
  await expect(page.getByRole('link', { name: 'Make my first mix' })).toHaveCount(0);
  await expect(page.locator('.readiness-steps')).toContainText('1 / 6 needed');
});

test('MP-0282-06 a missing folder, a refused folder and a folder with no audio each say what to do, right there', async ({ page }) => {
  const status = await realStatus(page);
  await statusFrom(page, () => firstRun(status));
  const answers = {
    missing: ['That folder isn’t there.', /plug that in first/],
    no_access: ['SelectaDJ isn’t allowed to read that folder.', /Choose a folder your account can open/],
    no_audio: ['No audio files in that folder.', /found no audio files, including in subfolders/],
    not_a_folder: ['That’s a file, not a folder.', /address of the folder it’s in/],
  } as const;
  let kind: keyof typeof answers = 'missing';
  await page.route('**/api/folders/check*', (route) => route.fulfill({ json: { ok: false, kind, reason: answers[kind][0] } }));
  const scans: string[] = [];
  page.on('request', (sent) => { if (sent.url().includes('/api/scan') && sent.method() === 'POST') scans.push(sent.url()); });
  for (const width of [320, 1440]) {
    await at(page, width);
    for (const next of Object.keys(answers) as (keyof typeof answers)[]) {
      kind = next;
      const box = page.getByRole('textbox', { name: 'Music folder' });
      await box.fill(`D:\\${next}`);
      await page.getByRole('button', { name: 'Start' }).click();
      await expect(page.getByRole('alert').filter({ hasText: answers[next][0] })).toBeVisible();
      await expect(page.locator('form > .hint')).toHaveText(answers[next][1]);
      const found = await page.evaluate(startParts);
      const where = `${width}px ${next}`;
      // the next step follows the reason directly, under the field, on its edge
      expect(found.advice!.top - found.error!.bottom, `${where}: advice far from the reason`).toBeLessThanOrEqual(24);
      expect(found.advice!.top, `${where}: advice above the reason`).toBeGreaterThanOrEqual(found.error!.bottom - 0.5);
      expect(Math.abs(found.advice!.left - found.input!.left), `${where}: advice off the field’s edge`).toBeLessThanOrEqual(1);
      expect(found.advice!.bottom, `${where}: advice off the first screen`).toBeLessThanOrEqual(900);
      await expect(box).toBeEnabled();
    }
  }
  expect(scans, 'a refused folder started a scan').toEqual([]);
});

test('MP-0282-07 a newly ready library leads with the Make a Mix action', async ({ page, request }) => {
  await request.post('/api/mix/clear');
  await page.addInitScript(() => window.localStorage.removeItem('selecta.startedAMix'));
  for (const [width, height] of [[375, 667], [1440, 900]] as const) {
    await at(page, width, '/mixes', height);
    await expect(page.locator('.setup-steps li[aria-current="step"]')).toContainText('Start listening');
    await expect(page.getByRole('status').filter({ hasText: 'enough ready songs to make a first mix' })).toBeVisible();
    const play = page.locator('.mix-quick').getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeEnabled();
    await expect(play).toHaveClass(/primary/);
    // it is in the first screen, and it is the first action on the page
    const found = await play.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const first = [...document.querySelectorAll<HTMLElement>('main#main button, main#main a.button')].find((item) => item.getClientRects().length && !item.closest('.tabs'));
      return { bottom: rect.bottom, first: first === button };
    });
    expect(found.bottom, `${width}px: Play below the first screen`).toBeLessThanOrEqual(height);
    expect(found.first, `${width}px: something comes before Play`).toBe(true);
  }
  await resetMix(request);
});

test('MP-0282-08 a returning listener keeps their place through a lost connection and a restart', async ({ page, request }) => {
  await page.addInitScript(() => window.localStorage.setItem('selecta.startedAMix', '1'));
  await at(page, 1280, '/library');
  const search = page.getByRole('searchbox', { name: 'Search your library' });
  await search.fill('a');
  await expect(page).toHaveURL(/[?&]q=a/);
  const rows = await page.locator('.library-rows .song-row').count();
  // the server goes away: the page stays, says so once, and nothing is reset to the first run
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await expect(page.locator('.connection[role="alert"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Where’s your music?' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/library\?.*q=a/);
  await expect(search).toHaveValue('a');
  await expect(page.locator('.library-rows .song-row')).toHaveCount(rows);
  // and it comes back by itself, in the same place
  await page.unroute('**/api/**');
  await expect(page.locator('.connection')).toHaveCount(0, { timeout: 20_000 });
  await expect(search).toHaveValue('a');
  // a restart (reload) keeps the address, the search and the current mix, and never shows setup again
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search your library' })).toHaveValue('a');
  await expect(page.locator('.setup-steps')).toHaveCount(0);
  const current = (await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id);
  expect(current).toEqual([1, 2, 3, 4]);
  // even with the mix cleared, someone who has already played one is past setup
  await request.post('/api/mix/clear');
  await page.goto('/mixes');
  await expect(page.locator('.setup-steps')).toHaveCount(0);
  await resetMix(request);
});
