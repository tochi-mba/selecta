import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PAGES, resetMix } from './helpers';

/**
 * ADR-0298 responsive geometry, accessibility and lab performance, measured in Edge against the
 * synthetic library in tests/e2e_server.py. These are lab candidates: a screen reader session, a real
 * phone and an installed app on a device are a person's job (MP-0298-04 and -07).
 */

async function open(page: Page, route: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

test('MP-0298-01 every page holds from 320 to 3840px, at both sides of 620 and 760, and in short landscape', async ({ page }, info) => {
  const SIZES = [[320, 640], [619, 800], [620, 800], [621, 800], [759, 900], [760, 900], [761, 900], [1280, 800], [1920, 1080], [3840, 2160], [568, 320], [1280, 600]] as const;
  const readings = [];
  for (const route of PAGES) {
    for (const [width, height] of SIZES) {
      await open(page, route, width, height);
      const reading = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Main"]');
        const heading = document.querySelector('main h1, main h2');
        return {
          scroll: document.documentElement.scrollWidth,
          nav: !!nav && [...document.querySelectorAll('nav[aria-label="Main"]')].some((node) => node.getBoundingClientRect().width > 0),
          heading: heading ? heading.getBoundingClientRect().width > 0 : false,
          errors: document.querySelectorAll('.section-failed, [data-section-failed]').length,
        };
      });
      const at = `${route} at ${width}x${height}`;
      expect(reading.scroll, `${at}: scrolls sideways`).toBeLessThanOrEqual(width);
      expect(reading.nav, `${at}: no way to the other pages`).toBe(true);
      expect(reading.heading, `${at}: no heading`).toBe(true);
      readings.push({ route, width, height, ...reading });
    }
  }
  writeFileSync(info.outputPath('mp-0298-01-widths.json'), JSON.stringify({ status: 'candidate-not-independently-verified', sizes: SIZES, pages: PAGES.length, readings: readings.length }, null, 2));
  expect(readings.length).toBe(PAGES.length * SIZES.length);
});

/** The Studio, stubbed with a synthetic song's stems (as mp-0274-optical-alignment.e2e.ts does). */
async function withStudio(page: Page) {
  const cells = 8;
  const row = Array.from({ length: cells }, (_, index) => (index < cells / 2 ? 1 : 0));
  const shape = { a: { vocals: row, drums: row, bass: row, other: row }, b: { vocals: row, drums: row, bass: row, other: row } };
  const stem = await (await page.request.get('/api/songs/1/audio')).body();
  await page.route('**/api/mix/1/studio*', (route) => route.fulfill({ json: { status: 'ready', key: 'zoom', cells, seconds: 8, bars: 16, start_shape: shape, shape } }));
  await page.route('**/api/mix/1/options*', async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), studio: { available: true } } });
  });
  await page.route('**/api/studio/**', (route) => route.fulfill({ body: stem, contentType: 'audio/flac' }));
}

test('MP-0298-02 200% and 400% zoom keep every page actionable, and the Studio has its list form', async ({ page }) => {
  // a 1280x1024 window at 200% is 640x512 CSS pixels, at 400% it is 320x256
  for (const [zoom, width, height] of [[200, 640, 512], [400, 320, 256]] as const) {
    for (const route of PAGES) {
      await open(page, route, width, height);
      const reading = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        clipped: [...document.querySelectorAll<HTMLElement>('main button, main a[href], main input:not([type="hidden"]), main select')]
          .filter((node) => node.getBoundingClientRect().width > 0)
          .filter((node) => { const rect = node.getBoundingClientRect(); return rect.right > innerWidth + 1 || rect.left < -1; })
          .map((node) => node.textContent?.trim().slice(0, 40) || node.getAttribute('aria-label')),
      }));
      const at = `${route} at ${zoom}%`;
      expect(reading.scroll, `${at}: scrolls sideways`).toBeLessThanOrEqual(width);
      expect(reading.clipped, `${at}: controls cut off at the side`).toEqual([]);
    }
  }
  // the Studio at 400%: the detailed list is a full alternative to the grid
  await withStudio(page);
  await open(page, '/mix/current/edit', 320, 256);
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  const list = page.getByRole('button', { name: 'Detailed list' });
  await list.scrollIntoViewIfNeeded();
  await list.click();
  await expect(list).toHaveAttribute('aria-pressed', 'true');
  const reading = await page.locator('.overlay-workspace .overlay-panel').evaluate((panel) => ({
    sideways: [...panel.querySelectorAll<HTMLElement>('*')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1 && node.getBoundingClientRect().width > 0 && getComputedStyle(node).position !== 'fixed').length,
    controls: panel.querySelectorAll('.overlay-body input, .overlay-body button').length,
  }));
  expect(reading.sideways, 'Studio list runs off the side at 400%').toBe(0);
  expect(reading.controls).toBeGreaterThan(8);
});

type Target = { name: string; tag: string; width: number; height: number; inline: boolean; spaced: boolean; primary: boolean };

async function targets(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="slider"], [role="tab"], [role="switch"], [role="checkbox"]';
    const nodes = [...document.querySelectorAll<HTMLElement>(selector)].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && !node.closest('[aria-hidden="true"], [inert], .visually-hidden') && node.getAttribute('disabled') === null;
    });
    // a checkbox or radio inside its label is hit through the label
    const hit = (node: HTMLElement) => (node.matches('input[type="checkbox"], input[type="radio"]') && node.closest('label') ? node.closest('label')! : node);
    const boxes = nodes.map((node) => hit(node).getBoundingClientRect());
    return nodes.map((node, index) => {
      const rect = boxes[index];
      const parent = node.parentElement;
      const inline = node.tagName === 'A' && getComputedStyle(node).display === 'inline' && !!parent && [...parent.childNodes].some((child) => child.nodeType === 3 && child.textContent!.trim().length > 0);
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      // WCAG 2.2 spacing exception: a 24px circle on the target touches no other target
      const spaced = boxes.every((other, at) => {
        if (at === index) return true;
        const dx = Math.max(other.left - centre.x, 0, centre.x - other.right);
        const dy = Math.max(other.top - centre.y, 0, centre.y - other.bottom);
        return Math.hypot(dx, dy) >= 12;
      });
      return {
        name: (node.getAttribute('aria-label') || node.textContent || node.getAttribute('name') || node.tagName).trim().slice(0, 50),
        tag: node.tagName.toLowerCase(), width: rect.width, height: rect.height, inline, spaced,
        primary: node.classList.contains('primary') || !!node.closest('nav[aria-label="Main"]'),
      };
    });
  });
}

test('MP-0298-03 every target meets 24px or a WCAG exception, and primary touch targets reach 44px', async ({ browser }, info) => {
  const report: Record<string, { measured: number; exceptions: string[] }> = {};
  for (const mode of ['desktop', 'touch'] as const) {
    const context = await browser.newContext(mode === 'touch'
      ? { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' }
      : { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const route of PAGES) {
      await page.goto(route);
      await expect(page.locator('main#main')).toBeVisible();
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      const found = await targets(page);
      const key = `${mode} ${route}`;
      report[key] = { measured: found.length, exceptions: [] };
      for (const target of found) {
        const small = target.width < 24 || target.height < 24;
        if (small && target.inline) { report[key].exceptions.push(`inline: ${target.name}`); continue; }
        if (small && target.spaced) { report[key].exceptions.push(`spacing: ${target.name}`); continue; }
        expect(small, `${key}: ${target.tag} "${target.name}" is ${Math.round(target.width)}x${Math.round(target.height)}`).toBe(false);
        if (mode === 'touch' && target.primary) expect(Math.min(target.width, target.height), `${key}: primary "${target.name}"`).toBeGreaterThanOrEqual(44);
      }
    }
    await context.close();
  }
  writeFileSync(info.outputPath('mp-0298-03-targets.json'), JSON.stringify({ status: 'candidate-not-independently-verified', report }, null, 2));
});

/** Contrast of every visible piece of text against what is actually behind it. */
async function contrast(page: Page) {
  return page.evaluate(() => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const over = (top: { r: number; g: number; b: number; a: number }, under: { r: number; g: number; b: number; a: number }) => ({
      r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1,
    });
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const [R, G, B] = [r, g, b].map((channel) => { const value = channel / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };
    const ratio = (one: { r: number; g: number; b: number }, two: { r: number; g: number; b: number }) => {
      const [light, dark] = [luminance(one), luminance(two)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };
    const behind = (node: Element): { colour: { r: number; g: number; b: number; a: number }; image: boolean } => {
      const layers = [];
      let image = false;
      for (let at: Element | null = node; at; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.backgroundImage !== 'none') image = true;
        const colour = parse(style.backgroundColor);
        if (colour && colour.a > 0) { layers.push(colour); if (colour.a >= 1) break; }
      }
      let result = parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.reverse()) result = over(layer, result);
      return { colour: result, image };
    };
    const failures: string[] = [];
    let measured = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const node = text.parentElement;
      if (!node || seen.has(node) || !text.textContent!.trim()) continue;
      seen.add(node);
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (!rect.width || !rect.height || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      if (node.closest('[aria-hidden="true"], .visually-hidden, [disabled], [aria-disabled="true"], script, style, noscript, option, canvas, svg')) continue;
      if (rect.bottom < 0 || rect.top > innerHeight * 3) continue;
      const back = behind(node);
      if (back.image) continue;
      const colour = parse(style.color);
      if (!colour) continue;
      const value = ratio(over(colour, back.colour), back.colour);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      measured += 1;
      if (value < (large ? 3 : 4.5)) failures.push(`${node.tagName.toLowerCase()}.${[...node.classList].join('.')} "${text.textContent!.trim().slice(0, 30)}" ${value.toFixed(2)}:1`);
    }
    // non-text: form field edges and status marks against what they sit on
    const indicators: string[] = [];
    for (const field of document.querySelectorAll<HTMLElement>('input[type="text"], input[type="search"], input:not([type]), select, textarea')) {
      const rect = field.getBoundingClientRect();
      if (!rect.width) continue;
      const style = getComputedStyle(field);
      const edge = parse(style.borderTopColor);
      const back = behind(field.parentElement!).colour;
      const fill = over(parse(style.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 }, back);
      if (!edge) continue;
      const best = Math.max(ratio(over(edge, back), back), ratio(fill, back));
      if (best < 3) indicators.push(`${field.tagName.toLowerCase()} "${field.getAttribute('aria-label') ?? field.id}" edge ${best.toFixed(2)}:1`);
    }
    return { failures, indicators, measured };
  });
}

test('MP-0298-05 text meets 4.5:1, large text 3:1 and field edges 3:1 in both themes', async ({ page }, info) => {
  const report: Record<string, number> = {};
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const route of PAGES) {
      await open(page, route, 1440, 900);
      const reading = await contrast(page);
      report[`${theme} ${route}`] = reading.measured;
      expect(reading.failures, `${theme} ${route}: text below its minimum`).toEqual([]);
      expect(reading.indicators, `${theme} ${route}: field edges below 3:1`).toEqual([]);
    }
  }
  writeFileSync(info.outputPath('mp-0298-05-contrast.json'), JSON.stringify({ status: 'candidate-not-independently-verified', measured: report }, null, 2));
});

test('MP-0298-06 (lab part) layout shift, largest paint and interaction delay stay inside budget', async ({ page }, info) => {
  await page.addInitScript(() => {
    const lab = { shift: 0, lcp: 0, events: [] as number[] };
    (window as unknown as { lab: typeof lab }).lab = lab;
    new PerformanceObserver((list) => { for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) lab.shift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) lab.lcp = Math.max(lab.lcp, entry.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) lab.events.push(entry.duration); }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  });
  const results: Record<string, unknown> = {};
  for (const route of PAGES) {
    await open(page, route, 1440, 900);
    await page.waitForTimeout(800);
    // a real interaction: open and close the command palette from the keyboard
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const lab = await page.evaluate(() => (window as unknown as { lab: { shift: number; lcp: number; events: number[] } }).lab);
    results[route] = { cls: Number(lab.shift.toFixed(3)), lcp: Math.round(lab.lcp), slowest_event: Math.round(Math.max(0, ...lab.events)) };
    expect(lab.shift, `${route}: cumulative layout shift`).toBeLessThan(0.1);
    expect(lab.lcp, `${route}: largest contentful paint`).toBeLessThan(2500);
    expect(Math.max(0, ...lab.events), `${route}: slowest interaction`).toBeLessThan(200);
  }
  writeFileSync(info.outputPath('mp-0298-06-lab.json'), JSON.stringify({ status: 'lab-candidate-one-machine', results }, null, 2));
});

test('MP-0298-07 (automated part) the installable app manifest is complete', async ({ page }) => {
  await page.goto('/listen');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest.name).toBeTruthy();
  expect(manifest.short_name).toBeTruthy();
  expect(['standalone', 'minimal-ui', 'fullscreen']).toContain(manifest.display);
  expect(manifest.start_url).toBeTruthy();
  const sizes = (manifest.icons as { sizes: string; src: string }[]).map((icon) => icon.sizes);
  expect(sizes.some((size) => size.includes('192'))).toBe(true);
  expect(sizes.some((size) => size.includes('512'))).toBe(true);
  for (const icon of manifest.icons as { src: string }[]) expect((await page.request.get(new URL(icon.src, page.url()).toString())).ok(), icon.src).toBe(true);
});
