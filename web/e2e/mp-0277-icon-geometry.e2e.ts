import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';
import { badge, iconReadings, labelGaps, look, nonHueCues, type Look } from './icon-measure';

/**
 * ADR-0277 icon sizes, badge baselines and button microgeometry, measured from the real stylesheet in Edge
 * against the synthetic library in tests/e2e_server.py. Candidates for an independent reviewer, not a human
 * visual approval. Inventory: docs/engineering/icon-inventory.md. Measuring functions: e2e/icon-measure.ts.
 */
const WIDTHS = [320, 768, 1440] as const;
const ROUTES = ['/mixes', '/library', '/mixes/mine', '/workshop', '/discover', '/mix/current/edit', '/listen', '/mixes/lucy'] as const;
const SLOT_PX: Record<string, number> = { compact: 14, toolbar: 16, standard: 20, hero: 28 };

/** The glyph table in the inventory: icon -> allowed slots. */
const inventory = readFileSync('../docs/engineering/icon-inventory.md', 'utf8');
const SLOTS_FOR = new Map([...inventory.slice(inventory.indexOf('## Glyphs')).matchAll(/^\| `([a-z]+)` \| [^|]+ \| ([^|]+) \|/gm)]
  .map((row) => [row[1], row[2].split(',').map((slot) => slot.trim())]));
/** The glyphs themselves, from ui/Icon.tsx. */
const PATHS = Object.fromEntries([...readFileSync('src/ui/Icon.tsx', 'utf8').matchAll(/^ {2}([a-z]+): '([^']+)',$/gm)].map((match) => [match[1], match[2]]));

async function open(page: Page, route: string, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

/** Requests waiting, as the server would list them, so the counters show real numbers. */
async function waiting(page: Page, count: number) {
  await page.unroute('**/api/requests');
  await page.route('**/api/requests', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const requests = Array.from({ length: count }, (_, index) => ({ id: index + 1, song_id: 1, title: 'Morning Light', artist: 'Synthetic', status: 'waiting', available: 0 }));
    return route.fulfill({ json: { requests } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0277-01 every visible icon is an inventoried glyph at its slot, aria-hidden, and named by its control or words', async ({ page, request }, info) => {
  await resetMix(request);
  const seen = new Map<string, Set<string>>();
  let measured = 0;
  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      await open(page, route, width);
      for (const icon of await page.evaluate(iconReadings)) {
        const at = `${icon.icon} (${icon.where}) on ${route} at ${width}px`;
        expect(SLOTS_FOR.get(icon.icon), `${at} is not in the inventory`).toBeDefined();
        expect(SLOTS_FOR.get(icon.icon), `${at} drawn at ${icon.size}, not an inventoried slot`).toContain(icon.size);
        expect(icon.hidden, `${at} is not aria-hidden`).toBe(true);
        expect(icon.name, `${at} has no name or words`).not.toBe('');
        if (!seen.has(icon.icon)) seen.set(icon.icon, new Set());
        seen.get(icon.icon)!.add(`${icon.size} ${icon.where.split(' ')[0]}`);
        measured += 1;
      }
    }
  }
  expect(measured, 'icons measured').toBeGreaterThan(400);
  writeFileSync(info.outputPath('mp-0277-01-icons.json'), JSON.stringify({ status: 'candidate-not-independently-verified', seen: Object.fromEntries([...seen].map(([name, uses]) => [name, [...uses]])) }, null, 2));
});

test('MP-0277-02 compact, toolbar, standard and hero icons draw at 14, 16, 20 and 28px', async ({ page, request }) => {
  await resetMix(request);
  const tokens = await (async () => {
    await open(page, '/mixes', 1440);
    return page.evaluate(() => {
      const probe = document.createElement('div');
      document.body.append(probe);
      const out = Object.fromEntries(['--icon-compact', '--icon-toolbar', '--icon-size', '--icon-hero'].map((name) => {
        probe.style.width = `var(${name})`;
        return [name, getComputedStyle(probe).width];
      }));
      probe.remove();
      return out;
    });
  })();
  expect(tokens).toEqual({ '--icon-compact': '14px', '--icon-toolbar': '16px', '--icon-size': '20px', '--icon-hero': '28px' });
  for (const width of WIDTHS) {
    const slots = new Set<string>();
    for (const route of ['/library', '/mix/current/edit', '/mixes/lucy', '/mixes']) {
      await open(page, route, width);
      for (const icon of await page.evaluate(iconReadings)) {
        const at = `${icon.icon} (${icon.where}) on ${route} at ${width}px`;
        expect(icon.width, `${at} box`).toBeCloseTo(SLOT_PX[icon.size], 1);
        expect(icon.height, `${at} box`).toBeCloseTo(SLOT_PX[icon.size], 1);
        slots.add(icon.size);
      }
    }
    // Lucy's 28px mark is hidden on phones (lucy.css), so the hero slot is drawn from 768px up
    expect([...slots].sort(), `slots drawn at ${width}px`).toEqual(width < 768 ? ['compact', 'standard', 'toolbar'] : ['compact', 'hero', 'standard', 'toolbar']);
  }
});

test('MP-0277-03 icon-to-words gaps hold in default, wrapped and busy states', async ({ page, request }) => {
  await resetMix(request);
  let regular = 0;
  let dense = 0;
  let wrapped = 0;
  const expectGap = (pair: Awaited<ReturnType<typeof labelGaps>>[number], where: string) => {
    if (pair.stacked) expect(pair.gap, where).toBeLessThanOrEqual(6);
    else if (pair.dense) { expect(pair.gap, where).toBeGreaterThanOrEqual(3); expect(pair.gap, where).toBeLessThanOrEqual(5); dense += 1; }
    else { expect(pair.gap, where).toBeGreaterThanOrEqual(7); expect(pair.gap, where).toBeLessThanOrEqual(9); regular += 1; }
  };
  for (const width of WIDTHS) {
    for (const route of ['/mix/current/edit', '/library', '/workshop', '/mixes', '/mixes/lucy']) {
      await open(page, route, width);
      for (const pair of await page.evaluate(labelGaps)) expectGap(pair, `${pair.where} on ${route} at ${width}px`);
      // wrapped: every icon-and-words button squeezed until its words take two lines keeps the same gap
      const squeezed = await page.evaluate(() => {
        const out: Array<{ where: string; before: number; after: number; lines: number; iconBefore: number; iconAfter: number }> = [];
        for (const button of document.querySelectorAll<HTMLElement>('main button:has(> svg.ui-icon), main a.button:has(> svg.ui-icon)')) {
          const icon = button.querySelector(':scope > svg.ui-icon')!.getBoundingClientRect();
          const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 6);
          if (!icon.width || !text) continue;
          const words = () => { const range = document.createRange(); range.selectNodeContents(text); return [...range.getClientRects()].filter((rect) => rect.width > 0); };
          const before = words()[0].left - icon.right;
          button.style.maxWidth = `${icon.width + 70}px`;
          button.style.whiteSpace = 'normal';
          const after = words();
          const iconAfter = button.querySelector(':scope > svg.ui-icon')!.getBoundingClientRect();
          out.push({ where: `${button.className} "${(button.textContent ?? '').trim().slice(0, 24)}"`, before, after: Math.min(...after.map((rect) => rect.left)) - iconAfter.right, lines: new Set(after.map((rect) => Math.round(rect.top))).size, iconBefore: icon.width, iconAfter: iconAfter.width });
          button.style.maxWidth = '';
          button.style.whiteSpace = '';
        }
        return out;
      });
      for (const button of squeezed.filter((entry) => entry.lines > 1)) {
        const where = `${button.where} wrapped on ${route} at ${width}px`;
        expect(Math.abs(button.after - button.before), `${where}: gap moved`).toBeLessThanOrEqual(0.5);
        expect(button.iconAfter, `${where}: icon shrank`).toBe(button.iconBefore);
        wrapped += 1;
      }
    }
  }
  expect(regular, 'regular pairs').toBeGreaterThan(40);
  expect(dense, 'dense pairs').toBeGreaterThan(20);
  expect(wrapped, 'wrapped buttons').toBeGreaterThan(5);

  // busy: Action keeps its idle label under the working words (ui/controls.tsx), so the row is the same row.
  // The editor's move buttons are real Actions: hold the move open and the icon does not move.
  for (const width of WIDTHS) {
    await open(page, '/mix/current/edit', width);
    const move = page.locator('.timeline [data-move="down"]').first();
    // boxes are read in the viewport, and the click scrolls a button below the fold into view first
    await move.scrollIntoViewIfNeeded();
    const before = await move.locator('svg').boundingBox();
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/mix/**', async (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      await held;
      return route.fallback();
    });
    await move.click();
    await expect(move).toHaveAttribute('aria-busy', 'true');
    const during = await move.locator('svg').boundingBox();
    expect(during, `busy move icon at ${width}px`).toEqual(before);
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await resetMix(request);
  }
  // an Action with an icon and working words (LucyComposer's Stop) uses the same markup; build one with the
  // real stylesheet and compare idle and busy, since Lucy's run state needs a model the test server lacks
  await open(page, '/mixes', 768);
  const action = await page.evaluate(() => {
    const icon = document.querySelector('svg.ui-icon')!.cloneNode(true) as SVGElement;
    const make = (busy: boolean) => {
      const button = document.createElement('button');
      button.innerHTML = `<span class="action-labels"><span ${busy ? 'aria-hidden="true" style="visibility:hidden"' : ''}></span><span ${busy ? '' : 'aria-hidden="true" style="visibility:hidden"'}>Stopping…</span></span>`;
      const idle = button.querySelector('.action-labels > span')!;
      idle.append(icon.cloneNode(true), document.createTextNode(' Stop'));
      document.querySelector('main')!.append(button);
      const svg = idle.querySelector('svg')!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(idle.lastChild!);
      const words = range.getClientRects()[0];
      const out = { gap: Math.round((words.left - svg.right) * 10) / 10, left: svg.left - button.getBoundingClientRect().left, width: button.getBoundingClientRect().width };
      button.remove();
      return out;
    };
    return { idle: make(false), busy: make(true) };
  });
  expect(action.idle.gap).toBeCloseTo(8, 0);
  expect(action.busy).toEqual(action.idle);
});

test('MP-0277-04 every slot draws about the same line, and every glyph fills the grid alike', async ({ page, request }, info) => {
  await resetMix(request);
  for (const width of WIDTHS) {
    for (const route of ['/library', '/mix/current/edit', '/mixes/lucy', '/listen']) {
      await open(page, route, width);
      for (const icon of await page.evaluate(iconReadings)) {
        const drawn = (icon.stroke * icon.width) / 24;
        expect(drawn, `${icon.icon} at ${icon.size} on ${route} at ${width}px draws ${drawn}px`).toBeGreaterThanOrEqual(1.35);
        expect(drawn, `${icon.icon} at ${icon.size} on ${route} at ${width}px draws ${drawn}px`).toBeLessThanOrEqual(1.45);
      }
    }
  }
  // every glyph's ink, measured by the browser on the 24px grid
  const glyphs = await page.evaluate((paths) => Object.fromEntries(Object.entries(paths).map(([name, d]) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
    document.body.append(svg);
    const box = path.getBBox();
    svg.remove();
    return [name, { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, extent: Math.max(box.width, box.height), cx: box.x + box.width / 2, cy: box.y + box.height / 2 }];
  })), PATHS);
  expect(Object.keys(glyphs).length).toBe(SLOTS_FOR.size);
  for (const [name, glyph] of Object.entries(glyphs)) {
    // ink plus half the widest stroke stays on the grid, so no slot clips a glyph
    expect(glyph.left - 1.2, `${name} left`).toBeGreaterThanOrEqual(0);
    expect(glyph.top - 1.2, `${name} top`).toBeGreaterThanOrEqual(0);
    expect(glyph.right + 1.2, `${name} right`).toBeLessThanOrEqual(24);
    expect(glyph.bottom + 1.2, `${name} bottom`).toBeLessThanOrEqual(24);
    // every glyph reads at a similar size: its longer side spans 12 to 21 of the 24 units
    expect(glyph.extent, `${name} extent`).toBeGreaterThanOrEqual(12);
    expect(glyph.extent, `${name} extent`).toBeLessThanOrEqual(21);
    // and sits near the middle of the grid; play's 1.5 units right is the triangle's optical centre
    expect(Math.abs(glyph.cx - 12), `${name} centre x`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(glyph.cy - 12), `${name} centre y`).toBeLessThanOrEqual(1.5);
  }
  writeFileSync(info.outputPath('mp-0277-04-glyphs.json'), JSON.stringify({ status: 'candidate-not-independently-verified', glyphs }, null, 2));
});

test('MP-0277-05 Requests and Activity counters stay centred on their icon and still as their digits change', async ({ page, request }) => {
  await resetMix(request);
  for (const width of WIDTHS) {
    const selector = width <= 760 ? '.context-request' : '.nav-request';
    const readings = [];
    for (const count of [1, 9, 12, 99]) {
      await waiting(page, count);
      await open(page, '/library', width);
      await expect(page.locator(`${selector} .count`)).toHaveText(String(count));
      readings.push((await page.evaluate(badge, selector))!);
    }
    const [first] = readings;
    for (const reading of readings) {
      const at = `Requests ${reading.text} at ${width}px`;
      expect(reading.inside, `${at}: count clipped`).toBe(true);
      expect(reading.after, `${at}: count is not after its icon`).toBe(true);
      expect(Math.abs(reading.countCy - reading.iconCy), `${at}: count off the icon's middle`).toBeLessThanOrEqual(1);
      expect(reading.digitsStart, `${at}: first digit moved`).toBe(first.digitsStart);
      expect(reading.iconLeft, `${at}: icon moved`).toBe(first.iconLeft);
      expect(reading.countCx, `${at}: badge moved`).toBe(first.countCx);
      expect(reading.controlWidth, `${at}: control changed width`).toBe(first.controlWidth);
    }
    await page.unroute('**/api/requests');
  }
  // Activity: a real change makes the first count; its digits are then changed in place
  for (const width of WIDTHS) {
    await resetMix(request);
    await open(page, '/mix/current/edit', width);
    await page.locator('.timeline [data-move="down"]').first().click();
    const activity = page.locator('.context-button[aria-label^="Activity,"]');
    await expect(activity.locator('.count')).toHaveText('1');
    await activity.evaluate((element) => element.setAttribute('data-probe', ''));
    const readings = [];
    for (const digits of ['1', '9', '12', '99']) {
      await activity.locator('.count').evaluate((element, text) => { element.textContent = text; }, digits);
      readings.push((await page.evaluate(badge, '[data-probe]'))!);
    }
    const [first] = readings;
    for (const reading of readings) {
      const at = `Activity ${reading.text} at ${width}px`;
      expect(reading.inside, `${at}: count clipped`).toBe(true);
      expect(Math.abs(reading.countCy - reading.iconCy), `${at}: count off the icon's middle`).toBeLessThanOrEqual(1);
      expect(reading.digitsStart, `${at}: first digit moved`).toBe(first.digitsStart);
      expect(reading.iconLeft, `${at}: icon moved`).toBe(first.iconLeft);
      expect(reading.controlWidth, `${at}: control changed width`).toBe(first.controlWidth);
    }
  }
  await resetMix(request);
});

test('MP-0277-06 hover, pressed, current, focus and disabled icons change more than hue, in Light and Dark', async ({ page, request }) => {
  await resetMix(request);
  const checked: string[] = [];
  const differ = (a: Look | null, b: Look | null, what: string) => {
    expect(a && b, what).toBeTruthy();
    const cues = nonHueCues(a!, b!);
    expect(cues.length, `${what} differs only by hue: ${JSON.stringify([a, b])}`).toBeGreaterThan(0);
    checked.push(`${what}: ${cues.join(', ')}`);
  };
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const width of [320, 1440]) {
      await open(page, '/mix/current/edit', width);
      const help = '.context-actions .context-button[aria-label="Keyboard shortcuts"]';
      const rest = await page.evaluate(look, help);
      await page.hover(help);
      differ(rest, await page.evaluate(look, help), `${theme} ${width}px shortcuts hover`);
      await page.mouse.move(0, 0);
      await page.keyboard.press('Tab');
      await page.locator(help).focus();
      differ(rest, await page.evaluate(look, help), `${theme} ${width}px shortcuts focus`);
      await page.locator(help).blur();
      // disabled: the first song can't move up, the second can
      await page.locator('.timeline [data-move="up"]').nth(0).evaluate((element) => element.setAttribute('data-probe', 'off'));
      await page.locator('.timeline [data-move="up"]').nth(1).evaluate((element) => element.setAttribute('data-probe', 'on'));
      differ(await page.evaluate(look, '[data-probe="on"]'), await page.evaluate(look, '[data-probe="off"]'), `${theme} ${width}px move up disabled`);
      // current destination, beside one that is not
      const nav = page.getByRole('navigation', { name: 'Main' });
      await nav.locator('a[aria-current="page"]').first().evaluate((element) => element.setAttribute('data-probe', 'here'));
      await nav.locator('li a:not([aria-current])').first().evaluate((element) => element.setAttribute('data-probe', 'away'));
      differ(await page.evaluate(look, '[data-probe="away"]'), await page.evaluate(look, '[data-probe="here"]'), `${theme} ${width}px current destination`);
      // pressed: mute on Listen
      await open(page, '/listen', width);
      const mute = page.locator('.volume button.icon');
      const unpressed = await page.evaluate(look, '.volume button.icon');
      await mute.click();
      await expect(mute).toHaveAttribute('aria-pressed', 'true');
      await page.mouse.move(0, 0);
      await mute.blur();
      differ(unpressed, await page.evaluate(look, '.volume button.icon'), `${theme} ${width}px mute pressed`);
      await mute.click();
    }
  }
  expect(checked.length).toBe(20);
  test.info().annotations.push({ type: 'cues', description: checked.join(' | ') });
});

test('MP-0277-07 icon-only controls have a name, a hint, a focus ring and a usable target', async ({ page, request, browser }) => {
  await resetMix(request);
  let measured = 0;
  const audit = async (target: Page, where: string, least: number) => {
    const controls = (await target.evaluate(iconReadings)).filter((icon) => icon.iconOnly);
    for (const control of controls) {
      const at = `${control.where} on ${where}`;
      expect(control.name, `${at} has no name`).not.toBe('');
      expect(control.hint, `${at} has no hint`).toBe(true);
      expect(control.controlWidth, `${at} width`).toBeGreaterThanOrEqual(least);
      expect(control.controlHeight, `${at} height`).toBeGreaterThanOrEqual(least);
      measured += 1;
    }
    // each one shows a ring when the keyboard reaches it
    await target.keyboard.press('Tab');
    const rings = await target.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, a')].filter((control) => {
      const icon = control.querySelector(':scope svg.ui-icon');
      return icon && control.getBoundingClientRect().width > 0 && !control.closest('[inert]') && control.getAttribute('aria-label') && !(control as HTMLButtonElement).disabled;
    }).slice(0, 12).map((control) => {
      control.focus();
      const style = getComputedStyle(control);
      const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2) || style.boxShadow !== 'none';
      control.blur();
      return { name: control.getAttribute('aria-label'), ring };
    }));
    for (const ring of rings) expect(ring.ring, `${ring.name} on ${where} shows no focus ring`).toBe(true);
  };
  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      await open(page, route, width);
      await audit(page, `${route} at ${width}px`, 24);
    }
  }
  // the collapsed rail is icons only
  await open(page, '/library', 1440);
  await page.getByRole('button', { name: 'Collapse the side bar' }).click();
  await audit(page, 'collapsed rail at 1440px', 24);
  await page.getByRole('button', { name: 'Expand the side bar' }).click();
  // touch: 44px on a coarse pointer
  const touch = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const phone = await touch.newPage();
  await phone.goto('/mix/current/edit');
  await expect(phone.locator('main#main')).toBeVisible();
  expect(await phone.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  for (const route of ['/mix/current/edit', '/library', '/listen', '/mixes/mine']) {
    await phone.goto(route);
    await expect(phone.locator('main#main')).toBeVisible();
    await audit(phone, `${route} on touch`, 44);
  }
  await touch.close();
  expect(measured, 'icon-only controls measured').toBeGreaterThan(150);
});

test('MP-0277-08 right to left and at 320px no glyph mirrors and no badge is clipped', async ({ page, request }) => {
  await resetMix(request);
  await waiting(page, 12);
  for (const dir of ['ltr', 'rtl'] as const) {
    for (const width of WIDTHS) {
      for (const route of ['/library', '/mix/current/edit', '/listen']) {
        await open(page, route, width);
        if (dir === 'rtl') await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
        for (const icon of await page.evaluate(iconReadings)) {
          const at = `${icon.icon} (${icon.where}) ${dir} on ${route} at ${width}px`;
          expect(icon.transform, `${at} is mirrored or turned`).toBe('none');
          expect(icon.width, `${at} box`).toBeCloseTo(SLOT_PX[icon.size], 1);
          expect(icon.inside, `${at} spills out of its control`).toBe(true);
          if (!icon.where.startsWith('nav') && !icon.where.includes('nav-')) expect(icon.onScreen, `${at} is off screen`).toBe(true);
        }
        if (dir === 'rtl') for (const pair of await page.evaluate(labelGaps)) {
          if (pair.stacked || pair.lines > 1) continue;
          expect(pair.gap, `${pair.where} rtl on ${route} at ${width}px`).toBeGreaterThanOrEqual(pair.dense ? 3 : 7);
          expect(pair.gap, `${pair.where} rtl on ${route} at ${width}px`).toBeLessThanOrEqual(pair.dense ? 5 : 9);
        }
        const selector = width <= 760 ? '.context-request' : '.nav-request';
        await expect(page.locator(`${selector} .count`)).toHaveText('12');
        const count = (await page.evaluate(badge, selector))!;
        expect(count.inside, `Requests badge ${dir} at ${width}px clipped`).toBe(true);
        expect(count.onScreen, `Requests badge ${dir} at ${width}px off screen`).toBe(true);
        expect(count.after, `Requests badge ${dir} at ${width}px is not after its icon in reading order`).toBe(true);
      }
    }
  }
});
