import { expect, test, type Page } from '@playwright/test';

/**
 * ADR-0293 workspace operations, storage, analysis and local backup layout, measured from the real
 * stylesheet in Edge against the synthetic library in tests/e2e_server.py. Server answers that the
 * synthetic library can't produce (a missing folder, paused analysis, a backup to restore) are
 * stubbed with made-up, private-data-free values. Candidates for an independent reviewer.
 */
const WIDTHS = [320, 768, 1440] as const;

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const box = (element: Element): Box => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
};

const JOBS = {
  worker: { running: true, rendering_the_mix: false },
  mix: { queued: 0, rendering: 0, failed: 0, none: 0, ready: 3 },
  drafts_in_line: 0,
  storage_full: false,
  analysis: { running: false, paused: false, asked_for: 0, left: 0 },
  failed_seams: [],
  failed_songs: [],
  estimates: '',
};

/** A made-up folder that has gone missing: long, with spaces and one unbroken run, and no real person's path. */
const LONG = 'D:\\Synthetic Music Archive\\Collections that were moved to another drive\\Very long folder name for layout testing\\' + 'Unbrokenfoldernamewithoutanyspaces'.repeat(4);

async function stubJobs(page: Page, jobs: Partial<typeof JOBS>) {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: { ...JOBS, ...jobs } }));
}

async function stubFolders(page: Page, missing: boolean) {
  await page.route('**/api/folders', (route) => route.fulfill({ json: { folders: [
    { path: 'C:\\Synthetic\\Music', available: true, songs: 12 },
    ...(missing ? [{ path: LONG, available: false, songs: 340 }] : []),
  ], watch_every: 60 } }));
}

async function open(page: Page, route: string, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0293-01 Workspace Overview puts what needs repair ahead of the passive counts', async ({ page }) => {
  await stubJobs(page, { analysis: { running: false, paused: true, asked_for: 0, left: 7 }, failed_songs: [{ id: 3, title: 'Synthetic song', artist: null }] });
  await stubFolders(page, true);
  for (const width of WIDTHS) {
    await open(page, '/workshop', width);
    const needs = page.locator('.needs-you');
    await expect(needs.locator('.needs-you-list li').first()).toBeVisible();
    const order = await page.evaluate(() => {
      const needsYou = document.querySelector('.needs-you')!.getBoundingClientRect();
      const metrics = document.querySelector('.metrics')!.getBoundingClientRect();
      const first = document.querySelector('.needs-you-list li a, .needs-you-list li button')!.getBoundingClientRect();
      return { needs: needsYou.top, metrics: metrics.top, action: first.bottom, height: innerHeight };
    });
    expect(order.needs, `${width}px: repair comes after the counts`).toBeLessThan(order.metrics);
    // the first repair is on screen without scrolling
    expect(order.action, `${width}px: first repair action is below the fold`).toBeLessThanOrEqual(order.height);
    await expect(needs.getByRole('link', { name: 'Look at those songs' })).toBeVisible();
    await expect(needs.getByRole('link', { name: 'Carry on' })).toBeVisible();
    await expect(needs.getByRole('link', { name: 'See your folders' })).toBeVisible();
  }
  // nothing to repair still says so first, and does so once it has looked
  await page.unroute('**/api/jobs');
  await page.unroute('**/api/folders');
  await open(page, '/workshop', 1440);
  await expect(page.locator('.needs-you')).toBeVisible();
  const [needsTop, metricsTop] = await page.evaluate(() => [document.querySelector('.needs-you')!.getBoundingClientRect().top, document.querySelector('.metrics')!.getBoundingClientRect().top]);
  expect(needsTop).toBeLessThan(metricsTop);
});

test('MP-0293-02 Analysis, Sources, Storage, Learning and Diagnostics share one rhythm', async ({ page }) => {
  const TABS = ['/workshop/analysis', '/workshop/sources', '/workshop/storage', '/workshop/learning', '/workshop/diagnostics'];
  for (const width of WIDTHS) {
    const readings = [];
    for (const route of TABS) {
      await open(page, route, width);
      await expect(page.locator('main .panel h2').first()).toBeVisible();
      await expect(page.locator('main .skeleton')).toHaveCount(0);
      readings.push(await page.evaluate((path) => {
        const panels = [...document.querySelectorAll<HTMLElement>('main > .panel, main > section.panel')];
        const tabs = document.querySelector('main .tabs, main [role="tablist"], main nav')!.getBoundingClientRect();
        const first = panels[0];
        const style = getComputedStyle(first);
        const heading = first.querySelector('h2')!;
        const headingStyle = getComputedStyle(heading);
        const gaps = panels.slice(1).map((panel, index) => panel.getBoundingClientRect().top - panels[index].getBoundingClientRect().bottom);
        return {
          path,
          left: first.getBoundingClientRect().left,
          right: first.getBoundingClientRect().right,
          lead: first.getBoundingClientRect().top - tabs.bottom,
          padding: [style.paddingTop, style.paddingLeft, style.paddingRight].join(' '),
          radius: style.borderTopLeftRadius,
          headingSize: headingStyle.fontSize,
          headingInset: heading.getBoundingClientRect().left - first.getBoundingClientRect().left,
          headingTop: heading.getBoundingClientRect().top - first.getBoundingClientRect().top,
          gaps,
        };
      }, route));
    }
    const [base] = readings;
    for (const reading of readings) {
      const at = `${reading.path} at ${width}px`;
      expect(Math.abs(reading.left - base.left), `${at}: panel left edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(reading.right - base.right), `${at}: panel right edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(reading.lead - base.lead), `${at}: space under the tabs`).toBeLessThanOrEqual(1);
      expect(reading.padding, `${at}: panel padding`).toBe(base.padding);
      expect(reading.radius, `${at}: panel corners`).toBe(base.radius);
      expect(reading.headingSize, `${at}: heading size`).toBe(base.headingSize);
      expect(Math.abs(reading.headingInset - base.headingInset), `${at}: heading inset`).toBeLessThanOrEqual(1);
      expect(Math.abs(reading.headingTop - base.headingTop), `${at}: heading top`).toBeLessThanOrEqual(1);
      for (const gap of reading.gaps) expect(Math.abs(gap - (readings.find((item) => item.gaps.length)?.gaps[0] ?? gap)), `${at}: gap between panels`).toBeLessThanOrEqual(1);
    }
  }
});

test('MP-0293-03 a long missing folder stays readable, next to its own Find moved folder action', async ({ page }) => {
  await stubFolders(page, true);
  for (const width of WIDTHS) {
    await open(page, '/workshop/sources', width);
    const row = page.locator('.folder-list li').filter({ hasText: 'Unbrokenfoldername' });
    await expect(row).toBeVisible();
    const reading = await row.evaluate((item) => {
      const name = item.querySelector('b')!;
      const action = [...item.querySelectorAll('button')].find((button) => button.textContent === 'Find moved folder')!;
      const style = getComputedStyle(name);
      return {
        text: name.textContent,
        name: name.getBoundingClientRect().toJSON(),
        row: item.getBoundingClientRect().toJSON(),
        action: action.getBoundingClientRect().toJSON(),
        clipped: name.scrollWidth > name.clientWidth + 1 || style.textOverflow === 'ellipsis' || style.overflow === 'hidden',
        page: document.documentElement.scrollWidth,
      };
    });
    const at = `${width}px`;
    expect(reading.text, `${at}: the whole path is there`).toBe(LONG);
    expect(reading.clipped, `${at}: the path is clipped`).toBe(false);
    expect(reading.page, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(width);
    expect(reading.name.right, `${at}: path runs out of its row`).toBeLessThanOrEqual(reading.row.right + 1);
    expect(reading.action.top, `${at}: the action is not in the folder's row`).toBeGreaterThanOrEqual(reading.row.top);
    expect(reading.action.bottom, `${at}: the action is not in the folder's row`).toBeLessThanOrEqual(reading.row.bottom + 1);
    expect(reading.action.height, `${at}: action target`).toBeGreaterThanOrEqual(24);
  }
  // the re-link dialog names the same folder in full, without sideways scrolling
  await open(page, '/workshop/sources', 320, 640);
  await page.locator('.folder-list li').filter({ hasText: 'Unbrokenfoldername' }).getByRole('button', { name: 'Find moved folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'Re-link a moved music folder' });
  await expect(dialog).toContainText(LONG);
  const overflow = await dialog.evaluate((panel) => [...panel.querySelectorAll<HTMLElement>('.overlay-body, .overlay-body *')].filter((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'visible').length);
  expect(overflow, 'dialog content scrolls sideways').toBe(0);
  expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1)).toBe(true);
});

const STORAGE = { used_bytes: 12 * 1024 ** 3, cache_bytes: 3 * 1024 ** 3, kept_bytes: 1024 ** 3, budget_bytes: 5 * 1024 ** 3, largest_budget_bytes: 40 * 1024 ** 3, smallest_budget_bytes: 1024 ** 3, free_bytes: 80 * 1024 ** 3, total_bytes: 100 * 1024 ** 3 };

test('MP-0293-04 the GB amount, slider and saved or warning line share one edge and stay together', async ({ page }) => {
  let failing = false;
  await page.route('**/api/storage', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: STORAGE });
    return failing ? route.fulfill({ status: 500, json: { detail: 'The budget could not be saved.' } }) : route.fulfill({ json: STORAGE });
  });
  const measure = () => page.evaluate(() => {
    const label = document.querySelector('label.limit')!;
    const amount = label.querySelector('span b')!.getBoundingClientRect();
    const words = label.querySelector('span')!.getBoundingClientRect();
    const slider = label.querySelector('input[type="range"]')!.getBoundingClientRect();
    const line = [...document.querySelectorAll('main .panel p[role="status"], main .panel p[role="alert"]')].find((node) => /Saved:|Saving|limit is still/.test(node.textContent ?? ''))!;
    const lineBox = line.getBoundingClientRect();
    return { amount: amount.toJSON(), words: words.toJSON(), slider: slider.toJSON(), line: lineBox.toJSON(), lineText: line.textContent, alert: line.getAttribute('role') === 'alert' };
  });
  for (const width of WIDTHS) {
    failing = false;
    await open(page, '/workshop/storage', width);
    await expect(page.locator('main p[role="status"]').filter({ hasText: 'Saved: 5.0 GB' })).toBeVisible();
    const saved = await measure();
    const at = `${width}px`;
    expect(Math.abs(saved.words.left - saved.slider.left), `${at}: amount and slider start apart`).toBeLessThanOrEqual(1);
    expect(Math.abs(saved.line.left - saved.slider.left), `${at}: saved line and slider start apart`).toBeLessThanOrEqual(1);
    expect(saved.amount.bottom, `${at}: amount overlaps the slider`).toBeLessThanOrEqual(saved.slider.top + 1);
    expect(saved.line.top - saved.slider.bottom, `${at}: saved line drifts from the slider`).toBeGreaterThanOrEqual(0);
    expect(saved.line.top - saved.slider.bottom, `${at}: saved line drifts from the slider`).toBeLessThanOrEqual(32);
    // a failed save: the warning takes the same place, and Retry is right under it
    failing = true;
    await page.getByRole('slider').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('alert').filter({ hasText: 'The limit is still 5.0 GB' })).toBeVisible();
    const warned = await measure();
    expect(warned.alert).toBe(true);
    expect(Math.abs(warned.line.left - warned.slider.left), `${at}: warning and slider start apart`).toBeLessThanOrEqual(1);
    // measured from the slider: focusing the slider can scroll the page, which moves both alike
    expect(Math.abs((warned.line.top - warned.slider.bottom) - (saved.line.top - saved.slider.bottom)), `${at}: warning moved from where Saved was`).toBeLessThanOrEqual(1);
    await expect(page.locator('label.limit b')).toHaveText('5.0 GB');
    const retry = page.getByRole('button', { name: 'Retry saving budget' });
    await expect(retry).toBeVisible();
    const retryTop = (await retry.boundingBox())!.y;
    expect(retryTop - warned.line.bottom, `${at}: Retry is far from its warning`).toBeLessThanOrEqual(32);
  }
});

test('MP-0293-05 queued, running, paused and failed jobs read differently in words and marks', async ({ page }) => {
  const kinds: Record<string, { words: string; icon: string; color: string }> = {};
  const collect = async () => {
    for (const reading of await page.locator('.job-list .status, .job-failures .status').evaluateAll((nodes) => nodes.map((node) => ({
      kind: [...node.classList].find((name) => name.startsWith('status-'))!,
      words: node.textContent ?? '',
      icon: node.querySelector('svg')?.innerHTML ?? '',
      color: getComputedStyle(node).color,
    })))) kinds[reading.kind] = reading;
  };
  await stubJobs(page, { mix: { queued: 0, rendering: 1, failed: 0, none: 0, ready: 2 }, analysis: { running: false, paused: true, asked_for: 0, left: 7 }, failed_songs: [{ id: 3, title: 'Synthetic song', artist: null }] });
  await open(page, '/workshop', 1440);
  await expect(page.locator('.job-list .status-paused')).toHaveText('Paused, 7 to go');
  await collect();
  await page.unroute('**/api/jobs');
  await stubJobs(page, { mix: { queued: 3, rendering: 0, failed: 0, none: 0, ready: 0 } });
  await open(page, '/workshop', 1440);
  await expect(page.locator('.job-list .status-queued').first()).toContainText('in line');
  await collect();
  const four = ['status-queued', 'status-working', 'status-paused', 'status-failed'];
  for (const kind of four) expect(kinds[kind], kind).toBeTruthy();
  expect(new Set(four.map((kind) => kinds[kind].icon)).size, 'each state has its own mark').toBe(4);
  expect(new Set(four.map((kind) => kinds[kind].words)).size, 'each state has its own words').toBe(4);
  expect(kinds['status-failed'].color, 'failed is coloured apart from paused').not.toBe(kinds['status-paused'].color);
  expect(kinds['status-working'].color, 'running is coloured apart from paused').not.toBe(kinds['status-paused'].color);
});

const PREVIEW = { token: 'synthetic-token', created_utc: '2026-11-01 09:30 UTC', counts: { songs: 120, drafts: 4, ratings: 37 }, replaces: 'library records, drafts, feedback and preferences', skips: 'music files, audio caches and exports' };

test('MP-0293-06 the restore preview, its consequence, the restart and the rollback are legible', async ({ page }) => {
  let staged = false;
  await page.route('**/api/backup/status', (route) => route.fulfill({ json: { pending_restart: staged, rollback_available: true, problem: null } }));
  await page.route('**/api/backup/preview', (route) => route.fulfill({ json: PREVIEW }));
  await page.route('**/api/backup/stage', (route) => { staged = true; return route.fulfill({ json: { ok: true } }); });
  for (const [width, height] of [[320, 568], [1440, 900]] as const) {
    await open(page, '/workshop/storage', width, height);
    const backup = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Local data backup' }) });
    await expect(backup.getByText('A pre-restore database rollback is preserved locally.')).toBeVisible();
    await backup.locator('input[type="file"]').setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer: Buffer.from('PK synthetic') });
    const validate = backup.getByRole('button', { name: 'Validate and preview restore' });
    await validate.click();
    const dialog = page.getByRole('dialog', { name: 'Replace local data on next restart?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('120 songs, 4 drafts, and 37 ratings');
    await expect(dialog).toContainText('Will replace:');
    await expect(dialog).toContainText('Will not replace:');
    await expect(dialog.locator('.warn')).toContainText('after you restart the app');
    const cancel = dialog.getByRole('button', { name: 'Cancel - keep current data' });
    const confirm = dialog.getByRole('button', { name: 'Confirm staged restore' });
    for (const control of [cancel, confirm]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(confirm).toHaveClass(/primary/);
    // the consequence is real text, not hint-sized grey
    const warnSize = await dialog.locator('.warn').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(warnSize).toBeGreaterThanOrEqual(14);
    if (width === 320) {
      await cancel.click();
      await expect(dialog).toHaveCount(0);
      await expect(validate).toBeFocused();
    } else {
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(backup.getByRole('status').filter({ hasText: 'waiting for a restart' })).toBeVisible();
      await expect(backup.getByText('No running data has been replaced yet.')).toBeVisible();
    }
  }
});

test('MP-0293-07 technical diagnostics stay folded away behind plain-language facts', async ({ page }) => {
  for (const width of WIDTHS) {
    await open(page, '/workshop/diagnostics', width);
    const facts = page.locator('.diagnostic-facts li');
    await expect(facts.first()).toBeVisible();
    const raw = page.locator('details.diagnostic-raw');
    await expect(raw).not.toHaveAttribute('open', '');
    await expect(raw.locator('pre')).toBeHidden();
    const reading = await page.evaluate(() => ({
      facts: document.querySelector('.diagnostic-facts')!.getBoundingClientRect().top,
      raw: document.querySelector('details.diagnostic-raw')!.getBoundingClientRect().toJSON(),
      panel: document.querySelector('details.diagnostic-raw')!.closest('.panel')!.getBoundingClientRect().height,
    }));
    expect(reading.facts, `${width}px: raw details come before the facts`).toBeLessThan(reading.raw.top);
    expect(reading.raw.height, `${width}px: summary target`).toBeGreaterThanOrEqual(44);
    expect(reading.raw.height / reading.panel, `${width}px: raw details dominate`).toBeLessThan(0.25);
    // still reachable from the keyboard
    await raw.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(raw.locator('pre')).toBeVisible();
    await expect(raw.locator('pre')).toContainText('api_version');
  }
});

test('MP-0293-08 the top issue can be diagnosed and repaired with the keyboard, with no hidden control on the way', async ({ page }) => {
  await stubJobs(page, {});
  await stubFolders(page, true);
  await page.route('**/api/folders/relink/preview', (route) => route.fulfill({ json: { from: LONG, to: 'E:\\Synthetic Music', total: 340, verified: 340, blocked: 0, token: 'synthetic', candidates: [] } }));
  let relinked = false;
  await page.route('**/api/folders/relink', (route) => { relinked = true; return route.fulfill({ json: { ok: true } }); });
  await open(page, '/workshop', 375, 667);
  const top = page.locator('.needs-you-list li').first();
  await expect(top).toContainText('music folder');
  const link = top.getByRole('link', { name: 'See your folders' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workshop\/sources$/);
  const find = page.locator('.folder-list li').filter({ hasText: 'Unbrokenfoldername' }).getByRole('button', { name: 'Find moved folder' });
  await find.focus();
  await expect(find).toBeInViewport();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Re-link a moved music folder' });
  await dialog.getByLabel('New local folder address').focus();
  await page.keyboard.type('E:\\Synthetic Music');
  const preview = dialog.getByRole('button', { name: 'Preview without changing anything' });
  await preview.focus();
  await page.keyboard.press('Enter');
  const confirm = dialog.getByRole('button', { name: 'Confirm 340 verified songs' });
  await confirm.focus();
  await expect(confirm).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(relinked).toBe(true);
  // every control on the way was a real, visible, sized target
  const hidden = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input, main summary')]
    .filter((node) => node.offsetParent !== null || getComputedStyle(node).position === 'fixed')
    .filter((node) => { const rect = node.getBoundingClientRect(); return rect.width < 1 || rect.height < 1 || getComputedStyle(node).visibility === 'hidden'; })
    .map((node) => node.outerHTML.slice(0, 80)));
  expect(hidden).toEqual([]);
});
