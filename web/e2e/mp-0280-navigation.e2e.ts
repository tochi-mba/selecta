import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { audioClock, resetMix, soundsStarted, spyOnAudio } from './helpers';

/**
 * ADR-280 navigation rail, breadcrumbs and phone bar, measured from the real stylesheet in Edge against
 * the synthetic library in tests/e2e_server.py. Candidates for an independent reviewer; the uncoached
 * novice task (MP-0280-08) needs people and is not attempted here.
 */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

async function open(page: Page, route: string, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(route);
  await expect(page.locator('main#main')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

async function railCollapsed(page: Page, collapsed: boolean) {
  const toggle = page.locator('.nav-collapse');
  if ((await toggle.getAttribute('aria-pressed')) !== String(collapsed)) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-rail', collapsed ? 'collapsed' : 'open');
}

/** Rail parts, in viewport pixels. */
function rail() {
  const box = (element: Element | null) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  };
  const nav = document.querySelector('nav.nav')!;
  const brand = nav.querySelector('.brand')!;
  const brandStyle = getComputedStyle(brand);
  const word = [...brand.children].find((child) => child.getClientRects().length && getComputedStyle(child).position !== 'absolute') ?? brand;
  const links = [...nav.querySelectorAll<HTMLElement>('li > a, li > button')].filter((link) => link.getClientRects().length);
  return {
    nav: box(nav)!,
    brand: box(brand)!,
    brandContentLeft: brand.getBoundingClientRect().left + parseFloat(brandStyle.paddingLeft),
    brandWord: box(word)!,
    links: links.map((link) => ({
      name: link.getAttribute('data-tip') ?? link.textContent?.trim(),
      current: link.getAttribute('aria-current'),
      box: box(link)!,
      icon: box(link.querySelector('svg, .ui-icon'))!,
      label: box([...link.querySelectorAll('.nav-label')].find((label) => getComputedStyle(label).position !== 'absolute') ?? null),
      fill: getComputedStyle(link).backgroundColor,
    })),
    foot: [...nav.querySelectorAll<HTMLElement>('.nav-foot > button')].filter((button) => button.getClientRects().length).map((button) => ({ box: box(button)!, icon: box(button.querySelector('svg, .ui-icon'))! })),
  };
}
const centreX = (box: { left: number; right: number }) => (box.left + box.right) / 2;
const centreY = (box: { top: number; bottom: number }) => (box.top + box.bottom) / 2;

test.beforeEach(async ({ page, request }) => {
  await resetMix(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0280-01 the open rail is 212px and its brand, rows and current marker share one edge', async ({ page }, info) => {
  const readings = [];
  for (const width of [1024, 1440, 1920]) {
    for (const route of ['/mixes', '/library', '/mix/current/edit']) {
      await open(page, route, width);
      await railCollapsed(page, false);
      const found = await page.evaluate(rail);
      const where = `${route} at ${width}px`;
      expect(found.nav.width, `${where}: rail width`).toBeCloseTo(212, 0);
      expect(found.links.length).toBeGreaterThanOrEqual(5);
      const first = found.links[0];
      for (const link of found.links) {
        expect(Math.abs(link.box.left - first.box.left), `${where}: ${link.name} row starts off the column`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(link.box.right - first.box.right), `${where}: ${link.name} row ends off the column`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(centreX(link.icon) - centreX(first.icon)), `${where}: ${link.name} icon off the icon column`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(link.label!.left - first.label!.left), `${where}: ${link.name} label off the label column`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(centreY(link.icon) - centreY(link.box)), `${where}: ${link.name} icon off its row middle`).toBeLessThanOrEqual(1);
        expect(link.box.height, `${where}: ${link.name} target`).toBeGreaterThanOrEqual(44);
      }
      // the brand word starts on the same edge as the row icons
      expect(Math.abs(found.brandContentLeft - first.icon.left), `${where}: brand off the row edge`).toBeLessThanOrEqual(1);
      // the current page is marked across the same box as every other row, so the marker lines up
      const current = found.links.filter((link) => link.current === 'page' || link.current === 'true');
      expect(current.length, `${where}: one current row`).toBe(1);
      expect(current[0].fill, `${where}: current row has a marker fill`).not.toBe('rgba(0, 0, 0, 0)');
      expect(found.nav.right - first.box.right, `${where}: right inset`).toBeCloseTo(first.box.left - found.nav.left, 0);
      readings.push({ where, ...found });
    }
  }
  writeFileSync(info.outputPath('mp-0280-01-rail.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0280-02 the 72px rail centres its icons, names them on hover and focus, and shows whole focus rings', async ({ page }) => {
  await open(page, '/library', 1280);
  await railCollapsed(page, true);
  const found = await page.evaluate(rail);
  expect(found.nav.width).toBeCloseTo(72, 0);
  const middle = centreX(found.nav);
  for (const link of found.links) {
    expect(Math.abs(centreX(link.icon) - middle), `${link.name} icon off the rail’s middle`).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY(link.icon) - centreY(link.box)), `${link.name} icon off its row middle`).toBeLessThanOrEqual(1);
    expect(link.box.height).toBeGreaterThanOrEqual(44);
    expect(link.box.width).toBeGreaterThanOrEqual(44);
  }
  for (const button of found.foot) expect(Math.abs(centreX(button.icon) - middle), 'foot icon off the middle').toBeLessThanOrEqual(1);
  expect(Math.abs(centreX(found.brandWord) - middle), 'brand mark off the middle').toBeLessThanOrEqual(1.5);

  const tip = (selector: string) => page.locator(selector).evaluate((link) => {
    const after = getComputedStyle(link, '::after');
    return { content: after.content, left: link.getBoundingClientRect().right };
  });
  const library = nav(page).getByRole('link', { name: 'Library', exact: true });
  await library.hover();
  expect((await tip('nav.nav a[data-tip="Library"]')).content, 'hover names the icon').toBe('"Library"');
  // keyboard focus names it too, and its ring is not clipped by the rail
  await page.mouse.move(800, 500);
  await library.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(library).toBeFocused();
  const focused = await library.evaluate((link) => {
    const style = getComputedStyle(link);
    const rect = link.getBoundingClientRect();
    const rail = link.closest('nav')!;
    const railStyle = getComputedStyle(rail);
    const outer = parseFloat(style.outlineWidth) + Math.max(parseFloat(style.outlineOffset), 0);
    return { tip: getComputedStyle(link, '::after').content, outline: style.outlineStyle, overflow: railStyle.overflowX, left: rect.left - outer, right: rect.right + outer, railLeft: rail.getBoundingClientRect().left, railRight: rail.getBoundingClientRect().right };
  });
  expect(focused.tip, 'focus names the icon').toBe('"Library"');
  expect(focused.outline, 'focus ring drawn').not.toBe('none');
  expect(focused.overflow === 'visible' || (focused.left >= focused.railLeft && focused.right <= focused.railRight), 'focus ring clipped by the rail').toBe(true);
  await railCollapsed(page, false);
});

test('MP-0280-03 Search, Requests, Theme, Activity and Help share one height, line and rhythm', async ({ page }, info) => {
  const readings = [];
  for (const width of [375, 768, 1440]) {
    await open(page, '/library', width);
    const found = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.context-actions > *')]
      .map((item) => (item.matches('button, a') ? item : item.querySelector<HTMLElement>('button')))
      .filter((button): button is HTMLElement => !!button && button.getClientRects().length > 0)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const icon = button.querySelector('svg, .ui-icon')?.getBoundingClientRect();
        return { name: button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, width: rect.width, iconY: icon ? (icon.top + icon.bottom) / 2 : null };
      }));
    const where = `${width}px`;
    expect(found.length, `${where}: actions shown`).toBeGreaterThanOrEqual(3);
    for (const button of found) {
      expect(Math.abs(button.height - found[0].height), `${where}: ${button.name} height`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(button.top - found[0].top), `${where}: ${button.name} off the line`).toBeLessThanOrEqual(0.5);
      expect(button.width, `${where}: ${button.name} narrower than a target`).toBeGreaterThanOrEqual(Math.min(found[0].height, 44));
      if (button.iconY !== null) expect(Math.abs(button.iconY - (button.top + button.bottom) / 2), `${where}: ${button.name} icon off middle`).toBeLessThanOrEqual(1);
    }
    const gaps = found.slice(1).map((button, index) => button.left - found[index].right);
    for (const gap of gaps) expect(Math.abs(gap - gaps[0]), `${where}: uneven gaps ${gaps}`).toBeLessThanOrEqual(0.5);
    readings.push({ width, found, gaps });
  }
  writeFileSync(info.outputPath('mp-0280-03-actions.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0280-04 deep crumbs and a long draft name stay whole and readable at narrow widths', async ({ page, request }) => {
  const long = 'Saturday sunrise set for the long drive home along the coast road';
  const made = await (await request.post('/api/drafts', { data: { name: long } })).json();
  try {
    for (const width of [320, 375, 768]) {
      for (const route of [`/mixes/drafts/${made.id}/edit`, '/workshop/diagnostics', '/discover/harmonic']) {
        await open(page, route, width);
        const where = `${route} at ${width}px`;
        const found = await page.evaluate(() => {
          const crumbs = document.querySelector('.crumbs')!;
          const actions = document.querySelector('.context-actions')!.getBoundingClientRect();
          const items = [...crumbs.querySelectorAll<HTMLElement>('li')].map((item) => ({ text: item.textContent, clipped: item.scrollWidth > item.clientWidth + 1, right: item.getBoundingClientRect().right, size: parseFloat(getComputedStyle(item).fontSize) }));
          const heading = document.querySelector<HTMLElement>('main#main h1');
          return { items, actionsLeft: actions.left, overflow: document.documentElement.scrollWidth - window.innerWidth, heading: heading ? { text: heading.textContent, clipped: heading.scrollWidth > heading.clientWidth + 1 || heading.scrollHeight > heading.clientHeight + 1 } : null };
        });
        expect(found.overflow, `${where}: scrolls sideways`).toBeLessThanOrEqual(0);
        expect(found.items.length, `${where}: crumbs`).toBeGreaterThanOrEqual(1);
        for (const item of found.items) {
          expect(item.clipped, `${where}: crumb “${item.text}” is clipped`).toBe(false);
          expect(item.right, `${where}: crumb “${item.text}” runs under the actions`).toBeLessThanOrEqual(found.actionsLeft + 0.5);
          expect(item.size, `${where}: crumb text too small`).toBeGreaterThanOrEqual(12);
        }
        if (route.includes('/drafts/')) {
          expect(found.heading!.text).toBe(long);
          expect(found.heading!.clipped, `${where}: draft name clipped`).toBe(false);
          await expect(page.locator('.crumbs [aria-current="page"]')).toHaveText('Edit draft');
        }
      }
    }
  } finally {
    await request.delete(`/api/drafts/${made.id}`);
  }
});

test('MP-0280-05 the phone bar spaces its icons, captions, More and targets evenly', async ({ page }, info) => {
  const readings = [];
  for (const width of [320, 375, 414, 760]) {
    await open(page, '/library', width, 800);
    const found = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('nav.nav li')]
      .filter((item) => item.getClientRects().length)
      .map((item) => {
        const target = [...item.querySelectorAll<HTMLElement>('a, button')].find((link) => link.getClientRects().length)!;
        const rect = item.getBoundingClientRect();
        const hit = target.getBoundingClientRect();
        const icon = target.querySelector('svg, .ui-icon')!.getBoundingClientRect();
        const caption = target.querySelector('.nav-label')!.getBoundingClientRect();
        return { name: target.textContent?.trim(), left: rect.left, width: rect.width, hitWidth: hit.width, hitHeight: hit.height, centre: rect.left + rect.width / 2, iconX: (icon.left + icon.right) / 2, iconTop: icon.top, captionX: (caption.left + caption.right) / 2, captionBottom: caption.bottom, clipped: target.scrollWidth > target.clientWidth + 1 };
      }));
    const where = `${width}px`;
    expect(found.map((item) => item.name)).toContain('More');
    for (const item of found) {
      expect(Math.abs(item.width - found[0].width), `${where}: ${item.name} wider than its neighbours`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(item.iconX - item.centre), `${where}: ${item.name} icon off centre`).toBeLessThanOrEqual(1);
      expect(Math.abs(item.captionX - item.centre), `${where}: ${item.name} caption off centre`).toBeLessThanOrEqual(1);
      expect(Math.abs(item.iconTop - found[0].iconTop), `${where}: ${item.name} icon off the line`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(item.captionBottom - found[0].captionBottom), `${where}: ${item.name} caption off the line`).toBeLessThanOrEqual(0.5);
      expect(item.hitWidth, `${where}: ${item.name} target width`).toBeGreaterThanOrEqual(44);
      expect(item.hitHeight, `${where}: ${item.name} target height`).toBeGreaterThanOrEqual(44);
      expect(item.clipped, `${where}: ${item.name} caption clipped`).toBe(false);
    }
    readings.push({ width, found });
  }
  writeFileSync(info.outputPath('mp-0280-05-phone-bar.json'), JSON.stringify({ status: 'candidate-not-independently-verified', readings }, null, 2));
});

test('MP-0280-06 the skip link and the focused destination stay discoverable in every rail mode', async ({ page }) => {
  for (const [mode, width] of [['open', 1280], ['collapsed', 1280], ['phone', 375]] as const) {
    await open(page, '/library', width);
    if (width > 760) await railCollapsed(page, mode === 'collapsed');
    await page.reload();
    await expect(page.locator('main#main')).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to the page' });
    await expect(skip, `${mode}: skip link first`).toBeFocused();
    const shown = await skip.evaluate((link) => {
      const rect = link.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { inView: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth, onTop: !!top && link.contains(top), height: rect.height };
    });
    expect(shown.inView, `${mode}: skip link off screen`).toBe(true);
    expect(shown.onTop, `${mode}: skip link covered`).toBe(true);
    // the next stop is a destination, with a visible ring that the bar does not cut off
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement;
      const style = getComputedStyle(focused);
      const rect = focused.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { inNav: !!focused.closest('nav.nav'), outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2, shadow: style.boxShadow !== 'none', inView: rect.top >= 0 && rect.bottom <= window.innerHeight + 0.5 && rect.left >= 0 && rect.right <= window.innerWidth + 0.5, onTop: !!top && focused.contains(top) };
    });
    expect(ring.inNav, `${mode}: second stop is in the navigation`).toBe(true);
    expect(ring.outline || ring.shadow, `${mode}: focused destination has no ring`).toBe(true);
    expect(ring.inView && ring.onTop, `${mode}: focused destination hidden`).toBe(true);
    // and the skip link really skips
    await page.keyboard.press('Shift+Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#content')).toBeFocused();
  }
  await open(page, '/library', 1280);
  await railCollapsed(page, false);
});

test('MP-0280-07 history, older addresses, drafts and playback survive moving around', async ({ page, request }) => {
  await spyOnAudio(page);
  await page.goto('/listen');
  await expect(page.locator('.lyrics')).toBeVisible();
  await page.locator('.now .transport .primary').click();
  await expect(page.locator('.now .transport .primary')).toHaveText('Pause', { timeout: 30_000 });
  const contexts = await page.evaluate(() => window.audioSpy.contexts.length);
  const started = await soundsStarted(page);
  const made = await (await request.post('/api/drafts', { data: { name: 'Route keeper' } })).json();
  try {
    for (const [name, path] of [['Library', '/library'], ['Make a Mix', '/mixes'], ['My Mixes', '/mixes/mine']] as const) {
      await nav(page).getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
    await page.getByRole('button', { name: 'Edit Route keeper', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/mixes/drafts/${made.id}/edit$`));
    await expect(page.locator('.editor-scope')).toHaveClass(/is-draft/);
    for (const [step, path] of [['back', '/mixes/mine'], ['back', '/mixes'], ['forward', '/mixes/mine'], ['forward', `/mixes/drafts/${made.id}/edit`]] as const) {
      if (step === 'back') await page.goBack(); else await page.goForward();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
    await expect(page.locator('.editor-scope')).toHaveClass(/is-draft/);
    // the music never restarted and no second player was made
    expect(await page.evaluate(() => window.audioSpy.contexts.length)).toBe(contexts);
    expect(await soundsStarted(page), 'a sound restarted while moving around').toBe(started);
    const [first] = await audioClock(page);
    await page.waitForTimeout(500);
    const [later] = await audioClock(page);
    expect(later - first, 'music stopped').toBeGreaterThan(0.2);
    const current = (await (await request.get('/api/mix')).json()).mix.map((item: { song_id: number }) => item.song_id);
    expect(current, 'editing a draft left the current mix alone').toEqual([1, 2, 3, 4]);
  } finally {
    await request.delete(`/api/drafts/${made.id}`);
  }
  // every older address still opens the page it always meant
  for (const [old, title] of [['/make', 'Make a Mix'], ['/explore', 'Make a Mix'], ['/my-mixes', 'My Mixes'], ['/workspace', 'Workspace'], ['/explore/harmonic', 'Harmonic matches'], ['/studies', 'Listening study']] as const) {
    await page.goto(old);
    await expect(page.locator('.crumbs [aria-current="page"]'), old).toHaveText(title);
  }
});
