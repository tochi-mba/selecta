import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';
import { borderJoins, buttonRows, cardFooters, chrome, clippedRings, iconCentring, pageAnchors } from './optical-measure';

/**
 * ADR-0274 optical alignment, grid guides and one-pixel details, measured from the real stylesheet in
 * Edge against the synthetic library in tests/e2e_server.py. Candidates for an independent reviewer,
 * not a human visual approval. Measuring functions: e2e/optical-measure.ts.
 */
const WIDTHS = [320, 768, 1440] as const;
const ROUTES = ['/mixes', '/library', '/mixes/mine', '/workshop', '/discover', '/mix/current/edit', '/listen'] as const;

async function open(page: Page, route: string, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  // the route reveal and any late data both settle before a pixel is read
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

/** The Studio, at the smallest real size, with stems served from a synthetic song (as finishing.e2e.ts does). */
async function withStudio(page: Page) {
  const cells = 8;
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const shape = { a: { vocals: row, drums: row, bass: row, other: row }, b: { vocals: row, drums: row, bass: row, other: row } };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => route.fulfill({ json: { status: 'ready', key: 'optical', cells, seconds: 8, bars: 16, start_shape: shape, shape } }));
  await page.route('**/api/mix/1/options*', async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), studio: { available: true } } });
  });
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

async function openInspector(page: Page) {
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await expect(page.locator('.inspector-identity')).toBeVisible();
}

async function openStudio(page: Page) {
  await openInspector(page);
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0274-01 crumbs, titles, filters, cards and lists start and end on the page column', async ({ page, request }, info) => {
  await resetMix(request);
  const ANCHORS = ['main h1', '.library-find', '.library-rows', '.vibe-group .cards', '.tabs', '.timeline', '.mix-head', '.listen-main', '.draft-tools', '.carry-on'];
  const readings = [];
  let anchored = 0;
  // 1920 as well: the work pages only centre once the window is wider than 1400px of column
  for (const width of [...WIDTHS, 1920]) {
    for (const route of ROUTES) {
      await open(page, route, width);
      const reading = await page.evaluate(pageAnchors, ANCHORS);
      const where = `${route} at ${width}px`;
      expect(reading.documentWidth, `${where} scrolls sideways`).toBeLessThanOrEqual(width);
      expect(Math.abs(reading.crumbs!.left - reading.column.left), `${where}: breadcrumb is off the column`).toBeLessThanOrEqual(1);
      expect(Math.abs(reading.actions!.right - reading.column.right), `${where}: bar actions end off the column`).toBeLessThanOrEqual(1);
      for (const anchor of reading.anchors) {
        // /listen's title sits inside its hero card; the column it starts is .listen-main
        if (route === '/listen' && anchor.selector === 'main h1') continue;
        expect(Math.abs(anchor.box.left - reading.column.left), `${where}: ${anchor.selector} starts off the column`).toBeLessThanOrEqual(1);
        expect(anchor.box.right, `${where}: ${anchor.selector} runs past the column`).toBeLessThanOrEqual(reading.column.right + 1);
        anchored += 1;
      }
      if (reading.scopeContent !== null) expect(Math.abs(reading.scopeContent - reading.column.left), `${where}: scope words off the column`).toBeLessThanOrEqual(1);
      readings.push({ route, width, ...reading });
    }
  }
  expect(anchored, 'anchors measured').toBeGreaterThan(60);
  writeFileSync(info.outputPath('mp-0274-01-anchors.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0274-02 icons sit optically centred in their hitboxes, and on their own words', async ({ page, request }) => {
  await resetMix(request);
  const counts = { icon: 0, inline: 0, stacked: 0 };
  const check = (controls: Awaited<ReturnType<typeof iconCentring>>, where: string) => {
    for (const control of controls) {
      const at = `${control.name} on ${where}`;
      counts[control.kind] += 1;
      if (control.kind === 'icon') {
        expect(Math.abs(control.iconDx), `${at} sits off centre sideways`).toBeLessThanOrEqual(1);
        expect(Math.abs(control.iconDy), `${at} sits off centre vertically`).toBeLessThanOrEqual(1);
      } else if (control.kind === 'inline') {
        expect(Math.abs(control.groupDy), `${at}: icon and words off the vertical centre`).toBeLessThanOrEqual(1);
        expect(Math.abs(control.wordDy), `${at}: icon is not on its words`).toBeLessThanOrEqual(1.5);
        if (control.centred) expect(Math.abs(control.groupDx), `${at}: centred content is off centre`).toBeLessThanOrEqual(1);
      } else {
        // the phone tab bar: icon above its label, the pair centred in the target
        expect(Math.abs(control.iconDx), `${at}: stacked icon is off centre`).toBeLessThanOrEqual(1);
        expect(Math.abs(control.groupDy), `${at}: stacked pair is off centre`).toBeLessThanOrEqual(1.5);
      }
    }
  };
  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      await open(page, route, width);
      check(await page.evaluate(iconCentring), `${route} at ${width}px`);
    }
  }
  // the mini-player and an overlay's close button, which only exist while playing and open
  for (const width of WIDTHS) {
    await open(page, '/listen', width);
    const play = page.locator('.now .transport .primary');
    await play.click();
    await expect(play).toHaveText('Pause', { timeout: 30_000 });
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.locator('.mini')).toBeVisible();
    check(await page.evaluate(iconCentring), `/library playing at ${width}px`);
    await page.getByRole('button', { name: /^Details for / }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    check(await page.evaluate(iconCentring), `song details at ${width}px`);
    await page.keyboard.press('Escape');
    await page.locator('.mini').getByRole('button', { name: 'Pause' }).click();
  }
  expect(counts.icon, 'icon-only controls measured').toBeGreaterThan(100);
  expect(counts.inline, 'icon and label controls measured').toBeGreaterThan(60);
  expect(counts.stacked, 'phone tab bar destinations measured').toBeGreaterThanOrEqual(5 * ROUTES.length);
});

test('MP-0274-03 the clock, counters and metadata numbers never move as they change', async ({ page, request }) => {
  await resetMix(request);
  for (const width of WIDTHS) {
    await open(page, '/listen', width);
    const time = page.locator('.strip .time').first();
    await expect(time).toBeVisible();
    const play = page.locator('.now .transport .primary');
    await play.click();
    await expect(play).toHaveText('Pause', { timeout: 30_000 });
    const samples: Array<{ text: string; left: number; right: number; top: number; bottom: number }> = [];
    for (let tick = 0; tick < 12; tick += 1) {
      samples.push(await time.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { text: element.textContent ?? '', left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }));
      await page.waitForTimeout(300);
    }
    await play.click();
    const texts = new Set(samples.map((sample) => sample.text));
    expect(texts.size, `the clock ticked at ${width}px`).toBeGreaterThan(1);
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const values = samples.map((sample) => sample[side]);
      expect(Math.max(...values) - Math.min(...values), `clock ${side} edge moved at ${width}px`).toBeLessThanOrEqual(0.5);
    }
    // the box already holds the longest reading this song can show: its duration on both sides
    const room = await time.evaluate((element) => {
      const duration = (element.textContent ?? '').split(' / ')[1];
      const probe = element.cloneNode() as HTMLElement;
      probe.removeAttribute('style');
      probe.style.cssText = 'position:absolute;visibility:hidden;min-width:0;width:auto';
      probe.textContent = `${duration} / ${duration}`.replace(/\d/g, '8');
      element.parentElement!.append(probe);
      const needed = probe.getBoundingClientRect().width;
      probe.remove();
      return { needed, has: element.getBoundingClientRect().width, numeric: getComputedStyle(element).fontVariantNumeric };
    });
    expect(room.has, `clock box too narrow for its longest reading at ${width}px`).toBeGreaterThanOrEqual(room.needed - 0.5);
    expect(room.numeric).toContain('tabular-nums');
  }
  // every number that updates in place uses equal-width digits
  for (const route of ['/library', '/mix/current/edit', '/workshop']) {
    await open(page, route, 1440);
    const loose = await page.evaluate(() => [...document.querySelectorAll('.time, .count, .facts, .library-summary b, .metrics strong, .scope-revision, .studio-playhead, .countdown-number strong')]
      .filter((element) => /\d/.test(element.textContent ?? '') && element.getBoundingClientRect().width > 0)
      .map((element) => ({ name: element.className || element.tagName, numeric: getComputedStyle(element).fontVariantNumeric, font: getComputedStyle(element).fontFamily }))
      .filter((reading) => !reading.numeric.includes('tabular-nums') && !/mono/i.test(reading.font)));
    expect(loose, `${route}: proportional digits in a changing number`).toEqual([]);
  }
});

test('MP-0274-04 buttons keep one row line, and idea cards one action line, when words wrap', async ({ page, request }) => {
  await resetMix(request);
  let wrapped = 0;
  let cardRows = 0;
  for (const width of WIDTHS) {
    for (const route of ['/mixes', '/mixes/mine', '/library', '/mix/current/edit', '/workshop', '/discover']) {
      await open(page, route, width);
      for (const row of await page.evaluate(buttonRows)) {
        const where = `${row.where} on ${route} at ${width}px`;
        expect(row.top, `${where}: buttons start on different lines`).toBeLessThanOrEqual(1);
        expect(row.bottom, `${where}: buttons end on different lines`).toBeLessThanOrEqual(1);
        if (row.wrapped) wrapped += 1;
      }
      if (route !== '/mixes') continue;
      for (const row of await page.evaluate(cardFooters)) {
        const lift = row.cardBottoms.map((bottom, index) => bottom - row.actionBottoms[index]);
        expect(Math.max(...row.actionBottoms) - Math.min(...row.actionBottoms), `idea card actions drift apart at ${width}px`).toBeLessThanOrEqual(1);
        expect(Math.max(...lift) - Math.min(...lift), `idea card actions sit at different depths at ${width}px`).toBeLessThanOrEqual(1);
        if (row.cards > 1) cardRows += 1;
      }
    }
  }
  expect(wrapped, 'rows where a label wraps were measured').toBeGreaterThan(0);
  expect(cardRows, 'rows of idea cards side by side were measured').toBeGreaterThan(2);
});

/** A bottom sheet is square where it meets the bottom of the screen: the one reviewed uneven corner. */
const CORNER_EXCEPTIONS = [{ name: 'div.overlay-panel', radii: ['10px', '10px', '0px', '0px'], maxWidth: 760 }];

async function expectClean(page: Page, where: string, width: number) {
  const joins = await page.evaluate(borderJoins);
  expect(joins.doubled, `${where}: doubled 1px edges`).toEqual([]);
  const uneven = joins.corners.filter((corner) => !CORNER_EXCEPTIONS.some((allowed) =>
    corner.name.startsWith(allowed.name) && width <= allowed.maxWidth && allowed.radii.join() === corner.radii.join()));
  expect(uneven, `${where}: uneven corners`).toEqual([]);
  const rings = await clippedRings(page);
  expect(rings.problems, `${where}: focus rings cut off`).toEqual([]);
  return rings.rings;
}

test('MP-0274-05 no doubled hairlines, uneven corners or clipped focus rings', async ({ page, request }) => {
  test.setTimeout(900_000);
  await resetMix(request);
  await withStudio(page);
  let rings = 0;
  for (const width of WIDTHS) {
    for (const route of ['/mixes', '/library', '/listen', '/mix/current/edit']) {
      await open(page, route, width);
      rings += await expectClean(page, `${route} at ${width}px`, width);
    }
    // the scope bar pinned under the context bar: one hairline where they meet, not two
    await open(page, '/mix/current/edit', width);
    await page.evaluate(() => window.scrollTo(0, 120));
    const pinned = await page.evaluate(chrome);
    expect(pinned.scope!.top, `scope not pinned at ${width}px`).toBeLessThan(pinned.header!.bottom);
    expect((await page.evaluate(borderJoins)).doubled, `pinned scope at ${width}px`).toEqual([]);
    await openStudio(page);
    rings += await expectClean(page, `Studio at ${width}px`, width);
  }
  expect(rings, 'focus rings measured').toBeGreaterThan(400);
});

test('MP-0274-06 the context bar, editor scope, inspector and Studio ruler never pin over each other', async ({ page, request }) => {
  await resetMix(request);
  await withStudio(page);
  for (const width of WIDTHS) {
    await open(page, '/mix/current/edit', width, 800);
    const first = await page.evaluate(chrome);
    // the published height is the bar's real one, wrapped crumbs and all
    expect(first.headerBlock).toBe(`${Math.ceil(first.header!.height)}px`);
    for (const y of [40, 120, 240, 400]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      const now = await page.evaluate(chrome);
      const where = `scrolled ${y}px at ${width}px`;
      expect(now.header!.top, where).toBe(0);
      // pinned, the scope sits under the bar sharing its 1px hairline; never further under it
      if (now.editorHead!.bottom > now.header!.bottom + now.scope!.height) {
        expect(now.scope!.top, `${where}: scope under the bar`).toBeGreaterThanOrEqual(now.header!.bottom - 1);
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await openInspector(page);
    if (width >= 1024) {
      for (const y of [300, 600, 1200]) {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        const now = await page.evaluate(chrome);
        const column = await page.locator('.inspector-column').evaluate((element) => element.getBoundingClientRect().bottom);
        // pinned, the panel sits below the bar and the scope; it only slides under the bar once its own column ends
        if (Math.abs(now.inspector!.bottom - column) > 1) {
          expect(now.inspector!.top, `inspector under the bar, scrolled ${y}px`).toBeGreaterThanOrEqual(now.header!.bottom);
          if (now.scope && now.scope.bottom > now.header!.bottom) expect(now.inspector!.top, `inspector over the scope, scrolled ${y}px`).toBeGreaterThanOrEqual(now.scope.bottom);
        }
      }
    }
    await page.getByRole('tab', { name: 'Studio' }).click();
    await page.getByRole('button', { name: 'Open the Studio' }).click();
    await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 60_000 });
    const studio = await page.evaluate(chrome);
    expect(studio.ruler!.top, `ruler under the Studio head at ${width}px`).toBeGreaterThanOrEqual(studio.studioHead!.bottom);
    // the ruler's sticky name holds the grid's left edge as the bars scroll past it
    await page.locator('.studio-grid').evaluate((grid) => { grid.scrollLeft = grid.scrollWidth; });
    const across = await page.evaluate(chrome);
    expect(Math.abs(across.rulerName!.left - across.grid!.left), `ruler name left the grid edge at ${width}px`).toBeLessThanOrEqual(1);
    expect(across.studioHead!.top).toBe(studio.studioHead!.top);
    await page.keyboard.press('Escape');
  }
  // Listen's side column pins under the bar's real height too
  await open(page, '/listen', 1440, 700);
  await page.evaluate(() => window.scrollTo(0, 600));
  const listen = await page.evaluate(chrome);
  const layoutEnd = await page.locator('.listen-layout').evaluate((element) => element.getBoundingClientRect().bottom);
  // pinned, the column sits under the bar; it only slides up once the layout holding it ends
  if (Math.abs(listen.side!.bottom - layoutEnd) > 1) expect(listen.side!.top, 'Listen side column under the bar').toBeGreaterThanOrEqual(listen.header!.bottom);
  else expect(listen.side!.top).toBeLessThan(listen.header!.bottom);
});

test('MP-0274-07 the scrollbar coming and going never moves the navigation or the page', async ({ page, request }) => {
  await resetMix(request);
  const fixed = (reading: Awaited<ReturnType<typeof chrome>>) => ({
    nav: [reading.nav?.left, reading.nav?.right], header: [reading.header?.left, reading.header?.right],
    crumbs: reading.crumbs?.left, actions: reading.actions?.right, main: [reading.main?.left, reading.main?.right],
  });
  for (const width of WIDTHS) {
    for (const route of ['/mixes', '/library', '/mix/current/edit']) {
      await open(page, route, width);
      const scrolling = fixed(await page.evaluate(chrome));
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter)).toBe('stable');
      // no scrollbar at all, as when a dialog locks the page
      await page.evaluate(() => { document.documentElement.style.overflow = 'hidden'; });
      expect(fixed(await page.evaluate(chrome)), `${route} at ${width}px without a scrollbar`).toEqual(scrolling);
      await page.evaluate(() => { document.documentElement.style.overflow = ''; });
      await page.getByRole('button', { name: /^Activity/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(fixed(await page.evaluate(chrome)), `${route} at ${width}px with Activity open`).toEqual(scrolling);
      await page.keyboard.press('Escape');
    }
  }
  // inside the inspector, a short tab and a long one keep the same edges
  await open(page, '/mix/current/edit', 1440);
  await openInspector(page);
  const edges = async () => page.evaluate(() => {
    const panel = document.querySelector('.edit-inspector')!;
    const identity = document.querySelector('.inspector-identity')!.getBoundingClientRect();
    return { gutter: getComputedStyle(panel).scrollbarGutter, client: panel.clientWidth, left: identity.left, right: identity.right };
  });
  const seen = [];
  for (const tab of ['Listen', 'Change', 'Studio', 'Details']) {
    await page.getByRole('tab', { name: tab }).click();
    seen.push(await edges());
  }
  expect(seen[0].gutter).toBe('stable');
  for (const reading of seen) expect(reading).toEqual(seen[0]);
});

/**
 * MP-0274-08: the offsets that are deliberately not on the plain grid, each owned by source, measured
 * here and held to its recorded value. An independent reviewer approves the rationale; this only keeps
 * the record true.
 */
const OPTICAL_EXCEPTIONS = [
  { id: 'scope-hairline', source: 'web/src/styles/creation.css .editor-scope', recorded: -1, unit: 'px from the bar bottom when pinned', rationale: 'the scope tucks its top border under the bar so the two share one 1px line' },
  { id: 'phone-tab-icon', source: 'web/src/styles/shell.css .nav li a (<=760px)', recorded: -10, unit: 'px icon centre above the target centre', rationale: 'icon stacked over its label; the pair, not the icon, is centred' },
  { id: 'inset-ring-tab-bar', source: 'web/src/styles/shell.css .nav li a:focus-visible', recorded: -4, unit: 'px outline offset', rationale: 'targets fill the scrolling list edge to edge; an outside ring is cut' },
  { id: 'inset-ring-studio', source: 'web/src/styles/creation.css .studio-grid .studio-name:focus-visible; polish.css .studio-cell', recorded: -4, unit: 'px outline offset', rationale: 'lane names pin to the grid scroller edge and cells touch; rings sit inside' },
  { id: 'sheet-corners', source: 'web/src/styles/shell.css .overlay-panel (<=760px)', recorded: 0, unit: 'px bottom corner radius', rationale: 'a bottom sheet meets the bottom of the screen square' },
  { id: 'clock-room', source: 'web/src/views/Now.tsx .time', recorded: 11, unit: 'ch reserved for m:ss / m:ss', rationale: 'the clock never widens as the minutes gain a digit' },
] as const;

test('MP-0274-08 recorded optical exceptions still measure what the record says', async ({ page, request }, info) => {
  await resetMix(request);
  await withStudio(page);
  const measured: Record<string, number> = {};
  await open(page, '/mix/current/edit', 1440);
  await page.evaluate(() => window.scrollTo(0, 120));
  const pinned = await page.evaluate(chrome);
  measured['scope-hairline'] = Math.round(pinned.scope!.top - pinned.header!.bottom);

  await open(page, '/mixes', 320);
  const tab = (await page.evaluate(iconCentring)).find((control) => control.kind === 'stacked')!;
  measured['phone-tab-icon'] = Math.round(tab.iconDy);
  await page.keyboard.press('Shift');
  measured['inset-ring-tab-bar'] = await page.locator('.nav li a').first().evaluate((link) => {
    (link as HTMLElement).focus();
    return link.matches(':focus-visible') ? parseFloat(getComputedStyle(link).outlineOffset) : NaN;
  });

  await open(page, '/mix/current/edit', 1440);
  await openStudio(page);
  await page.keyboard.press('Shift');
  measured['inset-ring-studio'] = await page.locator('.studio-lane:not(.studio-ruler) button.studio-name').first().evaluate((name) => {
    (name as HTMLElement).focus();
    return name.matches(':focus-visible') ? parseFloat(getComputedStyle(name).outlineOffset) : NaN;
  });
  await page.keyboard.press('Escape');

  await open(page, '/library', 320);
  await page.getByRole('button', { name: /^Details for / }).first().click();
  const panel = page.locator('.overlay-panel');
  await expect(panel).toBeVisible();
  measured['sheet-corners'] = await panel.evaluate((element) => parseFloat(getComputedStyle(element).borderBottomLeftRadius));
  await page.keyboard.press('Escape');

  await open(page, '/listen', 1440);
  measured['clock-room'] = await page.locator('.strip .time').first().evaluate((element) => {
    // the reservation as the source writes it (ch of the clock's own font); MP-0274-03 measures that it holds
    const reserved = (element as HTMLElement).style.minWidth;
    return reserved.endsWith('ch') ? Number.parseFloat(reserved) : NaN;
  });

  for (const exception of OPTICAL_EXCEPTIONS) expect(measured[exception.id], `${exception.id}: ${exception.rationale}`).toBe(exception.recorded);
  writeFileSync(info.outputPath('mp-0274-08-optical-exceptions.json'), JSON.stringify({
    status: 'candidate-awaiting-independent-reviewer',
    sourceSha: process.env.GITHUB_SHA ?? null,
    browser: 'msedge',
    fixture: 'tests/e2e_server.py',
    exceptions: OPTICAL_EXCEPTIONS.map((exception) => ({ ...exception, measured: measured[exception.id] })),
  }, null, 2));
});
