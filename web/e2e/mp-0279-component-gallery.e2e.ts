import { writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * ADR-279 shared component state gallery (web/src/ui/ControlGallery.tsx, Workspace > Diagnostics), measured
 * from the real stylesheet in Edge. The gallery ships in development builds and in test builds made with
 * VITE_SELECTA_GALLERY=1; this spec needs one of those. Per-state specimens are recorded as JSON for a
 * human reviewer: generating them is not approval (MP-0279-08).
 */
const GALLERY = '/workshop/diagnostics';

async function openGallery(page: Page, width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(GALLERY);
  const gallery = page.locator('details.control-gallery');
  await expect(gallery, 'build the site with VITE_SELECTA_GALLERY=1 for this spec').toHaveCount(1);
  await gallery.evaluate((details) => { (details as HTMLDetailsElement).open = true; });
  await expect(gallery.getByRole('heading', { name: 'Actions and feedback' })).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
  return gallery;
}

type Shot = { left: number; top: number; width: number; height: number; outline: string; outlineWidth: string; shadow: string; background: string; border: string; color: string; opacity: string; transform: string };
const snapshot = (control: Locator): Promise<Shot> => control.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, outline: style.outlineStyle, outlineWidth: style.outlineWidth, shadow: style.boxShadow, background: style.backgroundColor, border: style.borderColor, color: style.color, opacity: style.opacity, transform: style.transform };
});
const looks = (shot: Shot) => [shot.outline, shot.outlineWidth, shot.shadow, shot.background, shot.border, shot.color, shot.opacity].join('|');

/** Keyboard focus, so :focus-visible applies as it would for a real keyboard user. */
async function keyboardFocus(page: Page, control: Locator) {
  await control.evaluate((element) => {
    // only what Tab can reach, so a disabled neighbour never swallows the focus call
    const all = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [tabindex="0"]')].filter((item) => item === element || (!(item as HTMLButtonElement).disabled && item.tabIndex >= 0 && item.getClientRects().length > 0));
    // a tab is reached through its list's one Tab stop, so start just before the list
    const stop = element.getAttribute('role') === 'tab' ? element.closest('[role="tablist"]')!.querySelector<HTMLElement>('[role="tab"]')! : element as HTMLElement;
    const before = all.filter((item) => item !== element || item === stop);
    before[before.indexOf(stop) - 1]?.focus();
  });
  await page.keyboard.press('Tab');
  // a tab list has one Tab stop (roving tabindex, ARIA APG); a keyboard user reaches the other tabs with the arrows
  for (let step = 0; step < 5 && await control.getAttribute('role') === 'tab' && !(await control.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press('ArrowRight');
  await expect(control).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('MP-0279-01 controls, fields, tabs, menus, skeletons, overlays and statuses are all in the gallery', async ({ page }) => {
  const gallery = await openGallery(page);
  for (const name of ['Default', 'Primary', 'Disabled', 'Toggle selection', 'Example icon action', 'Working', 'Busy and disabled', 'Save', 'Tooltip', 'More actions', 'Delete example']) {
    await expect(gallery.getByRole('button', { name, exact: true }), `button ${name}`).toBeVisible();
  }
  for (const [role, name] of [['searchbox', 'Search'], ['textbox', 'Invalid field'], ['combobox', 'Choice'], ['slider', 'Range'], ['checkbox', 'Checkbox label']] as const) {
    await expect(gallery.getByRole(role, { name }), `${role} ${name}`).toBeVisible();
  }
  await expect(gallery.getByRole('tablist', { name: 'Example tabs' }).getByRole('tab')).toHaveCount(3);
  await gallery.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'First action' })).toBeVisible();
  // S31-0079-06: the destructive state is in the gallery, and looks different from an ordinary action
  await expect(page.getByRole('menuitem', { name: 'Delete from menu' })).toHaveClass(/destructive/);
  const colour = (name: string) => gallery.getByRole('button', { name, exact: true }).evaluate((element) => getComputedStyle(element).color);
  expect(await colour('Delete example'), 'destructive differs from default').not.toBe(await colour('Default'));
  await page.keyboard.press('Escape');
  expect(await gallery.locator('.status').count(), 'every status kind').toBeGreaterThanOrEqual(8);
  expect(await gallery.locator('.skeleton').count(), 'every skeleton variant').toBeGreaterThanOrEqual(9);
  await expect(gallery.getByRole('alert').filter({ hasText: 'could not be loaded' })).toBeVisible();
  await expect(gallery.locator('.empty-state')).toBeVisible();
  for (const kind of ['dialog', 'drawer'] as const) {
    await gallery.getByRole('button', { name: `Open ${kind}` }).click();
    await expect(page.getByRole('dialog', { name: `Example ${kind}` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: `Example ${kind}` })).toHaveCount(0);
  }
});

test('MP-0279-02 rest, hover, focus, pressed and selected keep each control’s geometry and look different', async ({ page }, info) => {
  const gallery = await openGallery(page);
  const specimens: Record<string, Record<string, Shot>> = {};
  const controls: [string, Locator][] = [
    ['Default', gallery.getByRole('button', { name: 'Default', exact: true })],
    ['Primary', gallery.getByRole('button', { name: 'Primary', exact: true })],
    ['Toggle selection', gallery.getByRole('button', { name: 'Toggle selection' })],
    ['Example icon action', gallery.getByRole('button', { name: 'Example icon action' })],
    ['Tab', gallery.getByRole('tab', { name: 'Second' })],
    ['Search field', gallery.getByRole('searchbox', { name: 'Search' })],
  ];
  for (const [name, control] of controls) {
    await control.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    const states: Record<string, Shot> = { rest: await snapshot(control) };
    await control.hover();
    states.hover = await snapshot(control);
    await page.mouse.move(1, 1);
    await keyboardFocus(page, control);
    states.focus = await snapshot(control);
    if (!name.includes('field')) {
      const box = (await control.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      states.pressed = await snapshot(control);
      await page.mouse.up();
      await page.mouse.move(1, 1);
    }
    if (name === 'Toggle selection') {
      await expect(control).toHaveAttribute('aria-pressed', 'true');
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      states.selected = await snapshot(control);
    }
    if (name === 'Tab') {
      await expect(control).toHaveAttribute('aria-selected', 'true');
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      states.selected = await snapshot(control);
    }
    for (const [state, shot] of Object.entries(states)) {
      const rest = states.rest;
      expect(Math.abs(shot.width - rest.width), `${name} ${state}: width changed`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(shot.height - rest.height), `${name} ${state}: height changed`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(shot.left - rest.left), `${name} ${state}: moved sideways`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(shot.top - rest.top), `${name} ${state}: moved up or down`).toBeLessThanOrEqual(0.5);
    }
    expect(states.focus.outline, `${name}: focus has no ring`).not.toBe('none');
    if (states.selected) expect(looks(states.selected), `${name}: selected looks like rest`).not.toBe(looks(states.rest));
    specimens[name] = states;
  }
  writeFileSync(info.outputPath('mp-0279-02-states.json'), JSON.stringify({ status: 'generated-not-approved', specimens }, null, 2));
});

test('MP-0279-03 disabled, busy, error and retry states keep the controls’ alignment', async ({ page }) => {
  const gallery = await openGallery(page);
  const row = gallery.locator('section').first().locator('.row').first();
  const heights = await row.evaluate((element) => [...element.querySelectorAll<HTMLElement>(':scope > button, :scope > .tooltip-anchor > button, :scope > .menu > button')]
    .map((button) => ({ name: button.textContent?.trim() || button.getAttribute('aria-label'), height: button.getBoundingClientRect().height, top: button.getBoundingClientRect().top })));
  const firstLine = heights.filter((item) => Math.abs(item.top - heights[0].top) < 4);
  for (const item of heights) expect(Math.abs(item.height - heights[0].height), `${item.name}: height`).toBeLessThanOrEqual(0.5);
  for (const item of firstLine) expect(Math.abs(item.top - heights[0].top), `${item.name}: off the line`).toBeLessThanOrEqual(0.5);

  // busy: the Save action keeps its box while it works, then returns
  const save = gallery.locator('section').first().locator('button:has(> .action-labels)'); // found by shape, as its name changes while it works (the problem's Try again is the other one)
  const rest = await snapshot(save);
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  const busy = await snapshot(save);
  expect(Math.abs(busy.width - rest.width), 'Save changes width while busy').toBeLessThanOrEqual(0.5);
  expect(Math.abs(busy.height - rest.height), 'Save changes height while busy').toBeLessThanOrEqual(0.5);
  await expect(gallery.getByText('Saved locally for this demonstration.')).toBeVisible();
  await expect(save).not.toHaveAttribute('aria-busy', 'true');

  // error: an invalid field is the same box as a valid one
  const invalid = await snapshot(gallery.getByRole('textbox', { name: 'Invalid field' }));
  const valid = await snapshot(gallery.getByRole('searchbox', { name: 'Search' }));
  expect(Math.abs(invalid.height - valid.height), 'invalid field height').toBeLessThanOrEqual(0.5);
  expect(Math.abs(invalid.left - valid.left), 'invalid field edge').toBeLessThanOrEqual(0.5);
  expect(looks(invalid), 'invalid looks like valid').not.toBe(looks(valid));

  // retry: the problem's Try again matches the other buttons and keeps its box while trying
  const retry = gallery.getByRole('button', { name: 'Try again' });
  const before = await snapshot(retry);
  expect(Math.abs(before.height - heights[0].height), 'Try again height').toBeLessThanOrEqual(0.5);
  await retry.click();
  const after = await snapshot(retry);
  expect(Math.abs(after.width - before.width), 'Try again width').toBeLessThanOrEqual(0.5);
});

test('MP-0279-04 focused and selected, and busy and disabled, both keep their meaning', async ({ page }) => {
  const gallery = await openGallery(page);
  const toggle = gallery.getByRole('button', { name: 'Toggle selection' });
  const rest = await snapshot(toggle);
  await keyboardFocus(page, toggle);
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeFocused();
  const both = await snapshot(toggle);
  expect(both.outline, 'focus ring lost on a selected control').not.toBe('none');
  expect(both.background, 'selection lost under focus').not.toBe(rest.background);
  // the ring stays a different colour from the selected fill, so both show
  const ring = await toggle.evaluate((element) => getComputedStyle(element).outlineColor);
  expect(ring).not.toBe(both.background);
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  const stuck = gallery.getByRole('button', { name: 'Busy and disabled' });
  await expect(stuck).toBeDisabled();
  await expect(stuck).toHaveAttribute('aria-busy', 'true');
  await expect(stuck).toHaveAccessibleName('Busy and disabled');
  const shown = await stuck.evaluate((element) => ({ opacity: getComputedStyle(element).opacity, bar: getComputedStyle(element, '::after').content, barHeight: getComputedStyle(element, '::after').height, cursor: getComputedStyle(element).cursor }));
  expect(Number(shown.opacity), 'disabled is not dimmed').toBeLessThan(1);
  expect(shown.bar, 'busy has no working bar').not.toBe('none');
  expect(shown.barHeight).toBe('2px');
  const plainBusy = await gallery.getByRole('button', { name: 'Working', exact: true }).evaluate((element) => getComputedStyle(element).opacity);
  expect(plainBusy, 'busy alone is dimmed like disabled').toBe('1');
});

test('MP-0279-05 label, hint, invalid reason and control stay bound on screen and for assistive technology', async ({ page }) => {
  for (const width of [320, 1280]) {
    const gallery = await openGallery(page, width);
    const field = gallery.locator('.gallery-field');
    const input = field.getByRole('textbox', { name: 'Invalid field' });
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(/A whole number of minutes\. Choose a value between 1 and 10\./);
    const parts = await field.evaluate((element) => {
      const box = (selector: string) => { const rect = element.querySelector(selector)!.getBoundingClientRect(); return { left: rect.left, top: rect.top, bottom: rect.bottom }; };
      return { label: box('label'), input: box('input'), help: box('.field-help'), error: box('.warn'), gap: parseFloat(getComputedStyle(element).rowGap || '0') };
    });
    const where = `${width}px`;
    const order = [parts.label, parts.input, parts.help, parts.error];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index].top, `${where}: part ${index} out of order`).toBeGreaterThanOrEqual(order[index - 1].bottom - 0.5);
      expect(order[index].top - order[index - 1].bottom, `${where}: part ${index} drifts away`).toBeLessThanOrEqual(12);
    }
    for (const part of order) expect(Math.abs(part.left - parts.input.left), `${where}: off the field’s edge`).toBeLessThanOrEqual(1);
  }
});

async function zoomed(browser: Browser, baseURL: string | undefined, zoom: number, forced = false) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280 / zoom, height: 900 / zoom }, deviceScaleFactor: zoom, reducedMotion: 'reduce', forcedColors: forced ? 'active' : 'none' });
  return { context, page: await context.newPage() };
}

test('MP-0279-06 the gallery stays usable at 320px, at 400% zoom and in forced colours', async ({ page, browser, baseURL }) => {
  const check = async (target: Page, where: string) => {
    const gallery = await openGallery(target, target.viewportSize()!.width, target.viewportSize()!.height);
    const found = await gallery.evaluate((root) => {
      const room = window.innerWidth;
      const controls = [...root.querySelectorAll<HTMLElement>('button, input, select, summary')].filter((control) => control.getClientRects().length);
      return {
        overflow: document.documentElement.scrollWidth - room,
        outside: controls.filter((control) => control.getBoundingClientRect().right > room + 1 || control.getBoundingClientRect().left < -1).map((control) => control.textContent?.trim() || control.getAttribute('aria-label')),
        clipped: controls.filter((control) => control.tagName === 'BUTTON' && control.scrollWidth > control.clientWidth + 2 && !control.hasAttribute('data-working')).map((control) => control.textContent?.trim()),
        count: controls.length,
      };
    });
    expect(found.count, `${where}: controls`).toBeGreaterThan(20);
    expect(found.overflow, `${where}: scrolls sideways`).toBeLessThanOrEqual(0);
    expect(found.outside, `${where}: controls off screen`).toEqual([]);
    expect(found.clipped, `${where}: button words cut off`).toEqual([]);
    // keyboard still reaches and shows the toggle
    const toggle = gallery.getByRole('button', { name: 'Toggle selection' });
    await keyboardFocus(target, toggle);
    expect((await snapshot(toggle)).outline, `${where}: focus ring`).not.toBe('none');
  };
  await check(page, '320px');
  await page.setViewportSize({ width: 320, height: 640 });
  await check(page, '320px');
  for (const [name, zoom, forced] of [['400% zoom', 4, false], ['forced colours', 1, true]] as const) {
    const { context, page: other } = await zoomed(browser, baseURL, zoom, forced);
    await other.setViewportSize({ width: zoom === 4 ? 320 : 1280, height: zoom === 4 ? 225 : 900 });
    try {
      await check(other, name);
      if (forced) {
        const status = await other.locator('.control-gallery .status').first().evaluate((element) => ({ icon: !!element.querySelector('svg'), text: element.textContent }));
        expect(status.icon && !!status.text, 'statuses keep a mark and words without colour').toBe(true);
      }
    } finally {
      await context.close();
    }
  }
});

test('MP-0279-07 reduced and still motion keep every state’s feedback without decoration', async ({ page }) => {
  for (const motion of ['reduce', 'still'] as const) {
    if (motion === 'still') {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(() => window.localStorage.setItem('selecta.prefs', JSON.stringify({ motion: 'still' })));
    }
    const gallery = await openGallery(page);
    if (motion === 'still') await expect(page.locator('html')).toHaveAttribute('data-motion', 'still');
    // nothing moves
    const moving = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length);
    expect(moving, `${motion}: animations still running`).toBe(0);
    const working = await gallery.getByRole('button', { name: 'Working', exact: true }).evaluate((element) => {
      const bar = getComputedStyle(element, '::after');
      return { name: bar.animationName, content: bar.content, height: bar.height };
    });
    expect(working.name, `${motion}: the working bar still slides`).toBe('none');
    expect(working.content, `${motion}: the working bar is gone`).not.toBe('none');
    expect(working.height).toBe('2px');
    const skeletons = await gallery.locator('.skeleton i').evaluateAll((items) => items.map((item) => getComputedStyle(item).animationName));
    for (const name of skeletons) expect(name, `${motion}: skeleton shimmers`).toBe('none');
    // focus, selection and busy words are all still there
    const toggle = gallery.getByRole('button', { name: 'Toggle selection' });
    await keyboardFocus(page, toggle);
    expect((await snapshot(toggle)).outline, `${motion}: focus ring`).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    const save = gallery.locator('section').first().locator('button:has(> .action-labels)'); // found by shape, as its name changes while it works (the problem's Try again is the other one)
    await save.click();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await expect(gallery.getByText('Saved locally for this demonstration.')).toBeVisible();
  }
});
