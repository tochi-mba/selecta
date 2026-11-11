import { expect, test, type Page } from '@playwright/test';
import { resetMix } from './helpers';

/**
 * ADR-0295 global overlays, command palette, Activity and toast geometry, measured from the real
 * stylesheet in Edge against the synthetic library in tests/e2e_server.py. Candidates for an
 * independent reviewer, not a human visual approval.
 */

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

/** A real notice, through the app's own way of reporting an uncaught failure (as overlay-arbitration.e2e.ts does). */
async function showProblem(page: Page, words = 'Something to notice.') {
  await page.evaluate((message) => {
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error(message) }));
  }, words);
  await expect(page.locator('.toast-row').filter({ hasText: words })).toBeVisible();
}

type Frame = { kind: string; head: string; body: string; foot: string | null; titleLeft: number; bodyLeft: number; radii: string[]; panel: DOMRect };

async function frame(page: Page): Promise<Frame> {
  await settle(page);
  return page.locator('.overlay-panel').last().evaluate((panel) => {
    const pad = (node: Element | null) => (node ? `${getComputedStyle(node).paddingLeft} ${getComputedStyle(node).paddingRight}` : null);
    const head = panel.querySelector('.overlay-head')!;
    const body = panel.querySelector('.overlay-body')!;
    const style = getComputedStyle(panel);
    return {
      kind: panel.parentElement!.className,
      head: pad(head)!, body: pad(body)!, foot: pad(panel.querySelector('.overlay-foot')),
      titleLeft: head.querySelector('h2')!.getBoundingClientRect().left,
      bodyLeft: body.getBoundingClientRect().left + parseFloat(getComputedStyle(body).paddingLeft),
      radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
      panel: panel.getBoundingClientRect().toJSON(),
    };
  });
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetMix(request);
});

test('MP-0295-01 dialog, sheet, drawer and palette share header, body, footer insets and corners', async ({ page }) => {
  for (const [width, height] of [[375, 667], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    const frames: Frame[] = [];
    await page.goto('/mixes');
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page.getByRole('dialog', { name: 'Shape the next mix' })).toBeVisible();
    frames.push(await frame(page));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Activity/ }).first().click();
    await expect(page.getByRole('dialog', { name: 'Activity' })).toBeVisible();
    frames.push(await frame(page));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Search and commands' })).toBeVisible();
    frames.push(await frame(page));
    await page.keyboard.press('Escape');
    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Change', exact: true }).first().click();
    await expect(page.locator('.inspector-identity')).toBeVisible();
    frames.push(await frame(page));
    const [base] = frames;
    for (const reading of frames) {
      const at = `${reading.kind} at ${width}px`;
      expect(reading.head, `${at}: header inset`).toBe(base.head);
      expect(reading.body, `${at}: body inset`).toBe(base.body);
      if (reading.foot) expect(reading.foot, `${at}: footer inset`).toBe(base.head);
      expect(Math.abs(reading.titleLeft - reading.bodyLeft), `${at}: title and body start apart`).toBeLessThanOrEqual(1);
      // a panel's free corners are all the same; a corner on a screen edge may be square
      const onEdge = (corner: number) => {
        const { left, right, top, bottom } = reading.panel;
        const edges = [[top <= 0.5, left <= 0.5], [top <= 0.5, right >= width - 0.5], [bottom >= height - 0.5, right >= width - 0.5], [bottom >= height - 0.5, left <= 0.5]][corner];
        return edges.some(Boolean);
      };
      const free = reading.radii.filter((_, corner) => !onEdge(corner));
      expect(new Set(free).size, `${at}: free corners ${reading.radii.join(' ')}`).toBeLessThanOrEqual(1);
      if (reading.kind.includes('overlay-dialog')) expect(new Set(reading.radii).size, `${at}: dialog corners`).toBe(1);
    }
    expect(frames.map((reading) => reading.kind.split(' ')[1])).toEqual(['overlay-dialog', 'overlay-drawer', 'overlay-dialog', 'overlay-sheet']);
    await page.keyboard.press('Escape');
  }
});

test('MP-0295-02 primary, cancel and destructive choices fit short windows at one height', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 600 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/mix/current/edit');
    await page.getByRole('button', { name: 'Clear', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Clear the current mix?' });
    await expect(dialog).toBeVisible();
    await settle(page);
    const reading = await dialog.evaluate((panel) => {
      const foot = panel.querySelector('.overlay-foot')!;
      const buttons = [...foot.querySelectorAll('button')].map((button) => ({ text: button.textContent, className: button.className, box: button.getBoundingClientRect().toJSON() }));
      return { buttons, foot: foot.getBoundingClientRect().toJSON(), panel: panel.getBoundingClientRect().toJSON() };
    });
    const at = `${viewport.width}x${viewport.height}`;
    expect(reading.buttons.map((button) => button.text)).toEqual(['Keep current mix', 'Clear current mix']);
    expect(reading.buttons[1].className, `${at}: destructive`).toContain('destructive');
    expect(new Set(reading.buttons.map((button) => Math.round(button.box.height))).size, `${at}: one height`).toBe(1);
    for (const button of reading.buttons) {
      expect(button.box.height, `${at}: target`).toBeGreaterThanOrEqual(44);
      expect(button.box.top, `${at}: ${button.text} above the top`).toBeGreaterThanOrEqual(0);
      expect(button.box.bottom, `${at}: ${button.text} below the window`).toBeLessThanOrEqual(viewport.height);
      expect(button.box.right, `${at}: ${button.text} past the edge`).toBeLessThanOrEqual(viewport.width);
    }
    // shallow: two choices take one row once there is room, never more than two rows
    const rows = new Set(reading.buttons.map((button) => Math.round(button.box.top))).size;
    if (viewport.width >= 768) expect(rows, `${at}: one row`).toBe(1);
    expect(rows).toBeLessThanOrEqual(2);
    expect(reading.panel.bottom, `${at}: panel below the window`).toBeLessThanOrEqual(viewport.height + 0.5);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});

test('MP-0295-03 songs, pages, playback and commands scan as separate labelled groups', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mixes');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search and commands' });
  await page.getByRole('combobox', { name: 'Search for a page or a command' }).fill('l');
  await expect(dialog.locator('.palette-group-name').first()).toBeVisible();
  await expect.poll(() => dialog.locator('.palette-group-name').count()).toBeGreaterThanOrEqual(2);
  await settle(page);
  const reading = await dialog.evaluate((panel) => {
    const groups = [...panel.querySelectorAll('.palette-group')].map((group) => {
      const name = group.querySelector('.palette-group-name');
      const items = [...group.querySelectorAll('[role="option"]')];
      return {
        name: name?.textContent ?? null,
        labelledBy: group.getAttribute('aria-labelledby'),
        nameStyle: name ? `${getComputedStyle(name).fontSize} ${getComputedStyle(name).color} ${getComputedStyle(name).textTransform}` : null,
        itemStyle: items[0] ? `${getComputedStyle(items[0].querySelector('bdi')!).fontSize} ${getComputedStyle(items[0].querySelector('bdi')!).color}` : null,
        top: group.getBoundingClientRect().top, bottom: group.getBoundingClientRect().bottom,
        lefts: items.map((item) => Math.round(item.getBoundingClientRect().left)),
        itemGaps: items.slice(1).map((item, index) => item.getBoundingClientRect().top - items[index].getBoundingClientRect().bottom),
        names: items.map((item) => item.getAttribute('aria-label') ?? ''),
      };
    });
    return groups;
  });
  const named = reading.filter((group) => group.name);
  expect(named.length).toBeGreaterThanOrEqual(2);
  const order = ['Songs', 'Your drafts', 'Go to', 'Playback', 'Do'];
  const positions = named.map((group) => order.indexOf(group.name!));
  expect(positions, 'groups in their fixed order').toEqual([...positions].sort((a, b) => a - b));
  for (const group of named) {
    expect(group.labelledBy, `${group.name} is labelled`).toBeTruthy();
    expect(group.nameStyle, `${group.name} heading looks like an item`).not.toBe(group.itemStyle);
    expect(new Set(group.lefts).size, `${group.name} items share an edge`).toBe(1);
    // every option says what kind of thing it is first
    for (const name of group.names) expect(name).toMatch(/^(Song|Draft|Page|Playback|Action|Search): /);
  }
  // groups sit further apart than the items inside them
  const between = named.slice(1).map((group, index) => group.top - named[index].bottom);
  const inside = Math.max(0, ...named.flatMap((group) => group.itemGaps));
  for (const gap of between) expect(gap, 'space between groups').toBeGreaterThan(inside);
  // all groups share one left edge
  expect(new Set(named.map((group) => group.lefts[0])).size).toBe(1);
});

test('MP-0295-04 notices never cover the bars, the mini-player or a dialog action', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/listen');
    const play = page.locator('.now .transport .primary');
    await play.click();
    await expect(play).toHaveText('Pause', { timeout: 30_000 });
    await page.getByRole('link', { name: 'Library' }).first().click();
    await expect(page.locator('.mini')).toBeVisible();
    await showProblem(page);
    await page.evaluate(() => window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('A second, longer notice to make sure a stack of notices still keeps out of the way of the bars.') })));
    await expect(page.locator('.toast-row')).toHaveCount(2);
    await settle(page);
    const reading = await page.evaluate(() => {
      const rect = (node: Element | null) => (node ? node.getBoundingClientRect().toJSON() : null);
      const toasts = rect(document.querySelector('.toasts'));
      const chrome = ['.mini', 'header.context-bar, .context-bar', 'nav[aria-label="Main"]']
        .map((selector) => ({ selector, box: [...document.querySelectorAll(selector)].filter((node) => (node as HTMLElement).offsetParent !== null || getComputedStyle(node).position === 'fixed').map((node) => node.getBoundingClientRect().toJSON()) }));
      const close = rect(document.querySelector('.toast-row .toast-close'));
      return { toasts, chrome, close, width: innerWidth, height: innerHeight };
    });
    const at = `${viewport.width}x${viewport.height}`;
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    for (const { selector, box } of reading.chrome) {
      for (const part of box) {
        if (part.width < 1 || part.height < 1) continue;
        expect(overlaps(reading.toasts!, part), `${at}: notices cover ${selector}`).toBe(false);
      }
    }
    expect(reading.toasts!.right, `${at}: off the right`).toBeLessThanOrEqual(reading.width);
    expect(reading.toasts!.left, `${at}: off the left`).toBeGreaterThanOrEqual(0);
    expect(reading.toasts!.height, `${at}: notices take over the screen`).toBeLessThanOrEqual(reading.height * 0.45);
    expect(reading.close!.height, `${at}: dismiss target`).toBeGreaterThanOrEqual(24);
    // a dialog is the active task: notices stay under it
    await page.goto('/mixes');
    await page.getByRole('button', { name: 'Customize' }).click();
    const dialog = page.getByRole('dialog', { name: 'Shape the next mix' });
    await showProblem(page);
    const done = dialog.getByRole('button', { name: 'Done shaping' });
    await done.scrollIntoViewIfNeeded();
    const covered = await done.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !(top === button || button.contains(top));
    });
    expect(covered, `${at}: a notice covers the dialog action`).toBe(false);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Dismiss' }).first().click().catch(() => {});
  }
});

test('MP-0295-06 delete, clear, replace and restore name exactly what they act on', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Clear', exact: true }).first().click();
  const clear = page.getByRole('dialog', { name: 'Clear the current mix?' });
  await expect(clear).toContainText('clears the current mix only');
  await expect(clear).toContainText('saved drafts and original music files stay untouched');
  await expect(clear.getByRole('button', { name: 'Clear current mix' })).toBeVisible();
  await expect(clear.getByRole('button', { name: 'Keep current mix' })).toBeVisible();
  await page.keyboard.press('Escape');
  // stop watching names the folder and says what it never does
  await page.route('**/api/folders', (route) => route.fulfill({ json: { folders: [{ path: 'C:\\Synthetic\\Evening Records', available: true, songs: 12 }], watch_every: 60 } }));
  await page.goto('/workshop/sources');
  await page.locator('.folder-list li').getByRole('button', { name: 'Stop watching' }).click();
  const unwatch = page.getByRole('dialog', { name: 'Stop watching this folder?' });
  await expect(unwatch.locator('b')).toHaveText('C:\\Synthetic\\Evening Records');
  await expect(unwatch).toContainText('never deletes, moves or changes files');
  await expect(unwatch.getByRole('button', { name: 'Keep watching' })).toBeVisible();
  await page.keyboard.press('Escape');
  // every destructive or replacing choice in the app names its object, never a bare OK or Yes
  const vague = await page.evaluate(() => [...document.querySelectorAll('.overlay-foot button')].filter((button) => /^(ok|yes|confirm|continue|delete|replace)$/i.test(button.textContent!.trim())).length);
  expect(vague).toBe(0);
});

test('MP-0295-07 an open software keyboard leaves the dialog action reachable and pushes chrome aside', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(page.locator('.mini')).toBeVisible();
  await showProblem(page);
  await page.goto('/workshop/sources');
  await page.route('**/api/folders/check*', (route) => route.fulfill({ json: { ok: true, kind: 'ok', reason: '' } }));
  await page.route('**/api/folders', (route) => route.fulfill({ json: { folders: [{ path: 'D:\\Synthetic', available: false, songs: 3 }], watch_every: 60 } }));
  await page.reload();
  await page.getByRole('button', { name: 'Find moved folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'Re-link a moved music folder' });
  const field = dialog.getByLabel('New local folder address');
  await field.focus();
  // what the app does when the on-screen keyboard opens (Shell.tsx): flag it and inset the layout by its height
  await page.evaluate(() => {
    document.documentElement.dataset.keyboard = 'open';
    document.documentElement.style.setProperty('--keyboard-inset', '300px');
  });
  await field.fill('E:\\Synthetic');
  const preview = dialog.getByRole('button', { name: 'Preview without changing anything' });
  await preview.scrollIntoViewIfNeeded();
  const reading = await preview.evaluate((button) => ({ bottom: button.getBoundingClientRect().bottom, height: innerHeight }));
  expect(reading.bottom, 'the action is under the keyboard').toBeLessThanOrEqual(reading.height - 300);
  await expect(page.locator('.toasts')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.mini')).toBeHidden();
  const cancel = dialog.getByRole('button', { name: 'Cancel - keep original paths' });
  await cancel.scrollIntoViewIfNeeded();
  expect(await cancel.evaluate((button) => button.getBoundingClientRect().bottom)).toBeLessThanOrEqual(reading.height - 300 + 0.5);
});

test('MP-0295-08 (automated part) routine notices are calm and a problem stays obvious', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/mix/current/edit');
  // a routine confirmation: clearing the mix says so politely, with Undo
  await page.getByRole('button', { name: 'Clear', exact: true }).first().click();
  await page.getByRole('button', { name: 'Clear current mix' }).click();
  const routine = page.locator('.toast-row.info').first();
  await expect(routine).toBeVisible();
  await showProblem(page, 'Couldn’t save the mix.');
  const problem = page.locator('.toast-row.problem');
  const styles = await page.evaluate(() => [...document.querySelectorAll('.toast-row')].map((row) => ({
    tone: row.classList.contains('problem') ? 'problem' : 'info', role: row.getAttribute('role'), background: getComputedStyle(row).backgroundColor,
  })));
  const info = styles.find((style) => style.tone === 'info')!;
  const bad = styles.find((style) => style.tone === 'problem')!;
  expect(info.role).toBe('status');
  expect(bad.role).toBe('alert');
  expect(bad.background, 'a problem looks different from a routine notice').not.toBe(info.background);
  // the problem is never pushed out by a routine notice (timings: controls.test.tsx 'go by themselves, and an Undo stays longer')
  await expect(problem).toBeVisible();
});
