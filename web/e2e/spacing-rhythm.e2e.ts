import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * ADR-0273 spacing and rhythm, measured from the real stylesheet in Edge against the synthetic
 * library in tests/e2e_server.py. Candidates for review, not a human visual approval.
 * Token roles: docs/engineering/spacing-token-map.md; raw-px lint: src/styles/spacing-tokens.test.ts.
 */
const WIDTHS = [320, 768, 1440] as const;
type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

async function size(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
}

async function open(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0273-01 spacing tokens resolve to the documented scale', async ({ page }) => {
  await open(page, '/mixes');
  const values = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const names = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
      '--space-hair', '--space-dense', '--space-snug', '--space-cozy', '--space-loose', '--icon-gap',
      '--icon-gap-dense', '--field-gap', '--rhythm-related', '--rhythm-group', '--rhythm-section',
      '--grid-beat-gap', '--grid-bar-gap', '--grid-cell-gap'];
    const probe = document.createElement('div');
    document.body.append(probe);
    const resolved = Object.fromEntries(names.map((name) => {
      probe.style.paddingTop = `var(${name})`;
      return [name, getComputedStyle(probe).paddingTop];
    }));
    probe.remove();
    return { resolved, raw: css.getPropertyValue('--space-2').trim() };
  });
  expect(values.raw).toBe('8px');
  expect(values.resolved).toEqual({
    '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px', '--space-5': '24px',
    '--space-6': '32px', '--space-7': '48px', '--space-hair': '2px', '--space-dense': '6px',
    '--space-snug': '10px', '--space-cozy': '14px', '--space-loose': '20px', '--icon-gap': '8px',
    '--icon-gap-dense': '4px', '--field-gap': '4px', '--rhythm-related': '12px', '--rhythm-group': '24px',
    '--rhythm-section': '32px', '--grid-beat-gap': '3px', '--grid-bar-gap': '2px', '--grid-cell-gap': '1px',
  });
});

/** Every visible icon with words after it in the same parent: the gap from the icon box to the words. */
async function iconGaps(page: Page) {
  return page.evaluate(() => {
    const DENSE = '.status, .locked-badge, .music-route';
    const out: Array<{ where: string; gap: number; drop: number; dense: boolean; stacked: boolean; lines: number }> = [];
    for (const icon of document.querySelectorAll<SVGElement>('.ui-icon')) {
      const box = icon.getBoundingClientRect();
      const parent = icon.parentElement;
      if (!parent || !box.width || getComputedStyle(parent).visibility === 'hidden') continue;
      let node = icon.nextSibling;
      let words: DOMRect | null = null;
      let lines = 0;
      while (node && !words) {
        const hidden = node instanceof HTMLElement && (node.classList.contains('visually-hidden') || !node.getBoundingClientRect().width);
        if (!hidden && (node.textContent ?? '').trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
          if (rects.length) { words = rects[0]; lines = new Set(rects.map((rect) => Math.round(rect.top))).size; }
        }
        node = node.nextSibling;
      }
      if (!words) continue;
      const stacked = words.top >= box.bottom - 1;
      out.push({
        where: `${parent.tagName.toLowerCase()}.${[...parent.classList].join('.')} "${(parent.textContent ?? '').trim().slice(0, 24)}"`,
        gap: Math.round((stacked ? words.top - box.bottom : words.left - box.right) * 10) / 10,
        drop: Math.round(Math.abs((words.top + words.height / 2) - (box.top + box.height / 2)) * 10) / 10,
        dense: !!parent.closest(DENSE),
        stacked,
        lines,
      });
    }
    return out;
  });
}

test('MP-0273-02 icons sit 8px from their own words, dense controls are the reviewed exceptions', async ({ page, request }) => {
  await resetMix(request);
  let regular = 0;
  let dense = 0;
  for (const width of WIDTHS) {
    await size(page, width);
    for (const route of ['/mix/current/edit', '/library', '/workshop', '/mixes']) {
      await open(page, route);
      if (route === '/mix/current/edit' && width === 1440) {
        await page.locator('.timeline .song-more').first().locator('button').first().click();
        await expect(page.getByRole('menuitem', { name: /Remove/ }).first()).toBeVisible();
      }
      for (const icon of await iconGaps(page)) {
        const where = `${icon.where} on ${route} at ${width}px`;
        if (icon.stacked) {
          // the phone tab bar puts each icon above its label: a stacked, dense destination
          expect(width, where).toBeLessThanOrEqual(760);
          expect(icon.gap, where).toBeLessThanOrEqual(6);
          dense += 1;
        } else if (icon.dense) {
          expect(icon.gap, where).toBeGreaterThanOrEqual(2);
          expect(icon.gap, where).toBeLessThanOrEqual(6);
          dense += 1;
        } else {
          expect(icon.gap, where).toBeGreaterThanOrEqual(7);
          expect(icon.gap, where).toBeLessThanOrEqual(9);
          regular += 1;
        }
        // a wrapped status centres its mark on the whole block, so only single lines are compared
        if (!icon.stacked && icon.lines === 1) expect(icon.drop, `${where} is not centred on its words`).toBeLessThanOrEqual(3);
      }
    }
  }
  expect(regular, 'measured icon and label pairs').toBeGreaterThan(30);
  expect(dense, 'measured dense exceptions').toBeGreaterThan(5);
});

async function fieldParts(page: Page, field: ReturnType<Page['locator']>) {
  return field.evaluate((element) => [...element.children].map((child) => {
    const box = child.getBoundingClientRect();
    return { tag: child.tagName.toLowerCase(), cls: child.className, left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
  }));
}

function expectStacked(parts: Array<{ tag: string; left: number; top: number; bottom: number; height: number }>, where: string) {
  for (let index = 1; index < parts.length; index += 1) {
    const gap = parts[index].top - parts[index - 1].bottom;
    expect(gap, `${where}: ${parts[index - 1].tag} to ${parts[index].tag} overlap`).toBeGreaterThanOrEqual(2);
    expect(gap, `${where}: ${parts[index - 1].tag} to ${parts[index].tag} drift apart`).toBeLessThanOrEqual(8);
    expect(Math.abs(parts[index].left - parts[0].left), `${where}: ${parts[index].tag} not aligned`).toBeLessThanOrEqual(1);
    expect(parts[index].height).toBeGreaterThan(0);
  }
}

test('MP-0273-03 label, control, help and error stay adjacent without overlap', async ({ page, request }) => {
  await resetMix(request);
  for (const width of WIDTHS) {
    await size(page, width);
    // three stacked fields with help: each part touches its neighbour, and fields keep apart
    await open(page, '/listening');
    const fields = page.locator('.study-setup .field');
    await expect(fields).toHaveCount(3);
    const boxes: Box[] = [];
    for (let index = 0; index < 3; index += 1) {
      const parts = await fieldParts(page, fields.nth(index));
      expect(parts.map((part) => part.tag)).toEqual(index < 2 ? ['label', 'input', 'p'] : ['label', 'input']);
      expectStacked(parts, `study field ${index + 1} at ${width}px`);
      boxes.push((await fields.nth(index).boundingBox()) as unknown as Box);
    }
    for (let index = 1; index < 3; index += 1) {
      const between = boxes[index].y - (boxes[index - 1].y + boxes[index - 1].height);
      expect(between, `fields ${index} and ${index + 1} must read as separate at ${width}px`).toBeGreaterThanOrEqual(8);
    }

    // a validation error joins its own field, under the help, without covering it
    await open(page, '/library');
    await page.getByRole('button', { name: /^Details for / }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const tempo = dialog.getByRole('spinbutton', { name: /^Tempo/ });
    await tempo.fill('999');
    await dialog.getByRole('button', { name: 'Save correction' }).click();
    const field = dialog.locator('.correct-field:has(input[type="number"])');
    await expect(field.getByRole('alert')).toBeVisible();
    await expect(tempo).toHaveAttribute('aria-invalid', 'true');
    const parts = await fieldParts(page, field);
    expect(parts.map((part) => `${part.tag}${part.cls ? `.${part.cls}` : ''}`)).toEqual(['label', 'input', 'p.field-help', 'p.warn']);
    expectStacked(parts, `tempo field with error at ${width}px`);
    expect(parts[3].right, 'error stays inside the dialog').toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
  }
});

test('MP-0273-04 headings keep a 12-48px rhythm to what they introduce and to the section before', async ({ page, request }) => {
  await resetMix(request);
  for (const width of WIDTHS) {
    await size(page, width);
    for (const route of ['/workshop', '/listening', '/mixes/mine', '/library', '/mix/current/edit']) {
      await open(page, route);
      const gap = await page.evaluate(() => {
        const heading = document.querySelector<HTMLElement>('main h1')!;
        // a heading unit is the title with its eyebrow and one-line summary; rhythm starts after it
        const rendered = (element: Element | null) => {
          while (element && !element.getBoundingClientRect().height) element = element.nextElementSibling;
          return element as HTMLElement | null;
        };
        let unit: HTMLElement = heading;
        for (;;) {
          while (unit.nextElementSibling?.matches('.lede, .hint, .library-summary, .library-readiness-help')) unit = unit.nextElementSibling as HTMLElement;
          if (rendered(unit.nextElementSibling) || unit.parentElement!.matches('main')) break;
          unit = unit.parentElement!; // a title wrapped with its summary: the wrapper is the unit
        }
        const next = rendered(unit.nextElementSibling);
        return next ? next.getBoundingClientRect().top - unit.getBoundingClientRect().bottom : null;
      });
      expect(gap, `${route} heading has nothing under it at ${width}px`).not.toBeNull();
      expect(gap!, `${route} page heading to content at ${width}px`).toBeGreaterThanOrEqual(12);
      expect(gap!, `${route} page heading to content at ${width}px`).toBeLessThanOrEqual(48);
    }

    // section titles open a new section: 24-48px after the previous one, close to what they introduce
    for (const route of ['/mixes', '/mixes/mine']) {
      await open(page, route);
      const titles = await page.locator('main .section-title').evaluateAll((elements) => elements.map((title) => {
        let start: Element = title.parentElement!.firstElementChild === title && title.parentElement!.matches('.row') ? title.parentElement! : title;
        while (start.previousElementSibling?.matches('.eyebrow')) start = start.previousElementSibling;
        let previous = start.previousElementSibling;
        while (previous && !previous.getBoundingClientRect().height) previous = previous.previousElementSibling;
        const box = title.getBoundingClientRect();
        let after = title.nextElementSibling;
        while (after && !after.getBoundingClientRect().height) after = after.nextElementSibling;
        const below = after && after.getBoundingClientRect().left >= box.left - 1 && after.getBoundingClientRect().top >= box.bottom - 1
          ? after.getBoundingClientRect().top - box.bottom : null;
        return {
          text: title.textContent, visible: box.height > 0,
          above: previous ? start.getBoundingClientRect().top - previous.getBoundingClientRect().bottom : null,
          below,
        };
      }));
      for (const title of titles.filter((entry) => entry.visible)) {
        const where = `"${title.text}" on ${route} at ${width}px`;
        if (title.above !== null) {
          expect(title.above, where).toBeGreaterThanOrEqual(24);
          expect(title.above, where).toBeLessThanOrEqual(48);
        }
        if (title.below !== null) {
          expect(title.below, where).toBeGreaterThanOrEqual(4);
          expect(title.below, where).toBeLessThanOrEqual(12);
        }
      }
    }

    // a group label to its cards is related text: 12px; groups are 24px apart
    await open(page, '/mixes');
    const groups = await page.locator('.vibe-group').evaluateAll((elements) => elements.map((group) => {
      const label = group.querySelector(':scope > .eyebrow')!.getBoundingClientRect();
      const cards = group.querySelector(':scope > .cards')!.getBoundingClientRect();
      const previous = group.previousElementSibling?.getBoundingClientRect();
      return { related: cards.top - label.bottom, apart: previous ? group.getBoundingClientRect().top - previous.bottom : null };
    }));
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      expect(group.related).toBeCloseTo(12, 0);
      if (group.apart !== null) expect(group.apart).toBeGreaterThanOrEqual(12);
      if (group.apart !== null) expect(group.apart).toBeLessThanOrEqual(48);
    }
  }
});

async function compactRows(page: Page) {
  return page.locator('.library-rows .song-row').evaluateAll((rows) => rows.slice(0, 4).map((row) => {
    const title = row.querySelector('.song-open b, .song-open') as HTMLElement;
    const meta = row.querySelector('.song-columns') as HTMLElement | null;
    const found = [...row.querySelectorAll<HTMLElement>('button, a, summary, .library-batch-check')]
      .map((element) => ({ element, box: element.getBoundingClientRect() })).filter(({ box }) => box.width && box.height);
    const targets = found.map(({ box }) => box);
    const least = found.sort((a, b) => Math.min(a.box.width, a.box.height) - Math.min(b.box.width, b.box.height))[0];
    return {
      height: row.getBoundingClientRect().height,
      title: Number.parseFloat(getComputedStyle(title).fontSize),
      meta: meta ? Number.parseFloat(getComputedStyle(meta).fontSize) : null,
      smallest: Math.min(...targets.map((box) => Math.min(box.width, box.height))),
      targets: targets.length,
      least: least ? `${least.element.tagName.toLowerCase()}.${least.element.className} ${Math.round(least.box.width)}x${Math.round(least.box.height)}` : '',
    };
  }));
}

test('MP-0273-06 compact rows stay readable with 24px targets, 44px on touch', async ({ page, browser, request }) => {
  await resetMix(request);
  for (const width of [768, 1440]) {
    await size(page, width);
    await open(page, '/library');
    const group = page.getByRole('group', { name: 'Row size' });
    await group.getByRole('button', { name: 'Comfortable' }).click();
    await expect(page.locator('.library-rows .song-row').nth(3)).toBeVisible();
    const comfortable = await compactRows(page);
    expect(comfortable).toHaveLength(4);
    await group.getByRole('button', { name: 'Compact' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    const compact = await compactRows(page);
    expect(compact).toHaveLength(4);
    for (const [index, row] of compact.entries()) {
      const where = `compact Library row ${index + 1} at ${width}px`;
      expect(row.title, where).toBeGreaterThanOrEqual(14);
      if (row.meta !== null) expect(row.meta, where).toBeGreaterThanOrEqual(12);
      expect(row.title, `${where}: compact changes space, never type`).toBe(comfortable[index].title);
      expect(row.targets, where).toBeGreaterThan(0);
      expect(row.smallest, `${where}: ${row.least}`).toBeGreaterThanOrEqual(24);
      expect(row.height, `${where} is denser than comfortable`).toBeLessThanOrEqual(comfortable[index].height);
    }
    const tokens = await page.locator('.library-rows').evaluate((element) => {
      const css = getComputedStyle(element);
      return { control: css.getPropertyValue('--control-height').trim(), pad: css.getPropertyValue('--row-pad').trim() };
    });
    expect(tokens.control).toBe('36px');

    // the editor timeline is the other compact surface
    await open(page, '/mix/current/edit');
    const editor = await page.locator('.timeline .song').first().evaluate((row) => ({
      title: Number.parseFloat(getComputedStyle(row.querySelector('.song-name b, .song-select b')!).fontSize),
      smallest: Math.min(...[...row.querySelectorAll<HTMLElement>('button')].map((button) => button.getBoundingClientRect())
        .filter((box) => box.width).map((box) => Math.min(box.width, box.height))),
    }));
    expect(editor.title).toBeGreaterThanOrEqual(14);
    expect(editor.smallest).toBeGreaterThanOrEqual(24);
    await open(page, '/library');
    await page.getByRole('group', { name: 'Row size' }).getByRole('button', { name: 'Comfortable' }).click();
  }

  // a touch screen keeps 44px targets even with compact chosen
  const touch = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const phone = await touch.newPage();
  await phone.goto('/library');
  await expect(phone.locator('main#main')).toBeVisible();
  expect(await phone.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await phone.getByRole('group', { name: 'Row size' }).getByRole('button', { name: 'Compact' }).click();
  await expect(phone.locator('html')).toHaveAttribute('data-density', 'compact');
  for (const row of await compactRows(phone)) {
    expect(row.title).toBeGreaterThanOrEqual(14);
    expect(row.smallest, `touch target in a compact row: ${row.least}`).toBeGreaterThanOrEqual(44);
  }
  await phone.getByRole('group', { name: 'Row size' }).getByRole('button', { name: 'Comfortable' }).click();
  await touch.close();
});

/** Scroll to the end and check the last control in the page sits clear of every fixed bar. */
async function endClearance(page: Page) {
  return page.evaluate(async () => {
    // long lists lay out rows only near the screen (content-visibility), so the page grows as it
    // scrolls: keep going to the end until the height settles
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settle = async () => {
      let height = -1;
      for (let round = 0; round < 20 && height !== document.documentElement.scrollHeight; round += 1) {
        height = document.documentElement.scrollHeight;
        window.scrollTo(0, height);
        await frame();
      }
      const controls = [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input, main select, main summary')]
        // checkVisibility drops controls inside a closed <details>, whose boxes are not drawn
        .filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && element.checkVisibility({ visibilityProperty: true }); });
      return controls.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).at(-1)!;
    };
    // late data (drafts, rows) can still arrive: the end is the same control twice, 200ms apart
    let last = await settle();
    for (let round = 0; round < 6; round += 1) {
      const before = last.getBoundingClientRect().bottom;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const again = await settle();
      if (again === last && again.getBoundingClientRect().bottom === before) break;
      last = again;
    }
    const chrome = [...document.querySelectorAll<HTMLElement>('.mini, nav[aria-label="Main"], .now .transport')]
      .map((element) => ({ element, box: element.getBoundingClientRect(), position: getComputedStyle(element).position }))
      .filter((bar) => bar.box.height > 0 && (bar.position === 'fixed' || bar.position === 'sticky') && bar.box.top > window.innerHeight / 2);
    const ceiling = Math.min(window.innerHeight, ...chrome.map((bar) => bar.box.top));
    // at the very end of the page, the last control is above the bars
    const atEnd = ceiling - last.getBoundingClientRect().bottom;
    // and reaching it by keyboard brings it into view clear of them (scroll padding)
    last.focus({ preventScroll: false });
    await frame();
    const box = last.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      what: `${last.tagName.toLowerCase()} "${(last.textContent ?? last.getAttribute('aria-label') ?? '').trim().slice(0, 30)}"`,
      clearance: atEnd,
      focused: ceiling - box.bottom,
      reachable: !!hit && (hit === last || last.contains(hit) || hit.contains(last)),
      hit: hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : `nothing at ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)} in ${innerWidth}x${innerHeight}`,
      bars: chrome.length,
    };
  });
}

test('MP-0273-07 the last action on a page clears the mini-player, the tab bar and the safe area', async ({ page, request }) => {
  await resetMix(request);
  for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await open(page, '/listen');
    const play = page.locator('.now .transport .primary');
    await play.click();
    await expect(play).toHaveText('Pause', { timeout: 30_000 });
    for (const [name, safe] of [['no inset', '0px'], ['34px home indicator', '34px']] as const) {
      await page.evaluate((inset) => document.documentElement.style.setProperty('--safe-bottom', inset), safe);
      // each page's own content has arrived before its end is measured
      const ready = { 'Library': '.library-rows .song-row', 'My Mixes': '.draft-list, .carry-on', 'Make a Mix': '.vibe-group .cards' } as const;
      for (const destination of ['Library', 'My Mixes', 'Make a Mix'] as const) {
        const navigation = page.getByRole('navigation', { name: 'Main' });
        const link = navigation.getByRole('link', { name: destination, exact: true });
        if (await link.isVisible()) await link.click();
        else continue;
        await expect(page.locator('.mini')).toBeVisible();
        await expect(page.locator(ready[destination]).first()).toBeVisible();
        const end = await endClearance(page);
        const where = `${end.what} on ${destination} at ${viewport.width}x${viewport.height}, ${name}`;
        expect(end.bars, where).toBeGreaterThan(0);
        expect(end.clearance, `${where} is under the fixed chrome`).toBeGreaterThanOrEqual(8);
        expect(end.focused, `${where} focused under the fixed chrome`).toBeGreaterThanOrEqual(0);
        expect(end.reachable, `${where} cannot be hit, ${end.hit} is on top`).toBe(true);
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Listen', exact: true }).click();
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('--safe-bottom'));
    await page.locator('.now .transport .primary').click();
  }
  // without a player, the workspace end still clears the tab bar with the inset
  await size(page, 320, 568);
  await open(page, '/workshop');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
  const end = await endClearance(page);
  expect(end.clearance, `${end.what} on Workspace at 320px`).toBeGreaterThanOrEqual(8);
  expect(end.reachable).toBe(true);
});

test('MP-0273-08 musical 1-3px gaps come from their own grid tokens at every width', async ({ page }) => {
  await open(page, '/mixes');
  for (const width of [320, 1440]) {
    await size(page, width);
    const gaps = await page.evaluate(() => {
      // the real stylesheet, real class names, two children each: the gap the grid actually draws.
      // Lucy's bars load with Lucy; spacing-tokens.test.ts holds their source ownership.
      const cases: Array<[string, string]> = [
        ['div.studio-lane', 'button.studio-cell'], ['span.beat-pips', 'i'], ['span.seam-visual-bars', 'i'],
        ['div.music-seam-diagram', 'span'], ['div.energy-overview>ol', 'li'], ['span.energy-thumb', 'i'],
      ];
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:0;top:0;width:600px;visibility:hidden';
      document.body.append(host);
      const out: Record<string, number> = {};
      for (const [outer, inner] of cases) {
        const [parentSpec, childSpec] = [outer.split('>'), inner];
        let container: HTMLElement = host;
        for (const spec of parentSpec) {
          const [tag, ...classes] = spec.split('.');
          const element = document.createElement(tag);
          element.className = classes.join(' ');
          container.append(element);
          container = element;
        }
        const [tag, ...classes] = childSpec.split('.');
        const items = [0, 1].map(() => {
          const element = document.createElement(tag);
          element.className = classes.join(' ');
          element.style.minWidth = '10px';
          element.style.minHeight = '10px';
          element.style.display = getComputedStyle(container).display.includes('grid') ? 'block' : element.style.display;
          container.append(element);
          return element;
        });
        const [a, b] = items.map((item) => item.getBoundingClientRect());
        const style = getComputedStyle(container);
        out[outer] = style.display.includes('grid') && style.gridTemplateColumns.split(' ').length < 2
          ? b.top - a.bottom : b.left - a.right;
      }
      host.remove();
      return out;
    });
    expect(gaps).toEqual({
      'div.studio-lane': 3, 'span.beat-pips': 3, 'span.seam-visual-bars': 3, 'div.music-seam-diagram': 3,
      'div.energy-overview>ol': 2, 'span.energy-thumb': 1,
    });
  }
});
