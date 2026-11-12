import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * UI/UX polish ADR-0035 P0022: the interaction state contract (docs/adr/completion/components.md) holds
 * in BOTH themes and with long labels. MP-0279 (mp-0279-component-gallery.e2e.ts) measures the states in
 * the default theme; this spec repeats the comparison under light and dark, on the development component
 * gallery (web/src/ui/ControlGallery.tsx), so the site must be built with VITE_SELECTA_GALLERY=1.
 *
 * Per theme: default, hover, focus, pressed, selected, disabled, busy, error and success each look
 * different from rest without moving the control, and at 320px the long labels (the longer tab, the
 * wrapping badge, the long song title and the Save action's longer working label) stay inside the page.
 */
const GALLERY = '/workshop/diagnostics';

type Look = { left: number; top: number; width: number; height: number; paint: string };
const look = (control: Locator): Promise<Look> => control.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const paint = [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow, style.backgroundColor, style.borderColor, style.color, style.opacity, style.textDecorationLine].join('|');
  return { left: rect.left + scrollX, top: rect.top + scrollY, width: rect.width, height: rect.height, paint };
});

async function open(page: Page, theme: 'light' | 'dark', width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((chosen) => window.localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen })), theme);
  await page.goto(GALLERY);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const gallery = page.locator('details.control-gallery');
  await expect(gallery, 'build the site with VITE_SELECTA_GALLERY=1 for this spec').toHaveCount(1);
  await gallery.evaluate((details) => { (details as HTMLDetailsElement).open = true; });
  await expect(gallery.getByRole('heading', { name: 'Actions and feedback' })).toBeVisible();
  // the Diagnostics panels above the gallery load their own data; measure once they have settled
  await expect(page.locator('[aria-busy="true"]:not(.control-gallery *)')).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  return gallery;
}

/** Keyboard focus: Tab from the element before, so :focus-visible applies. */
async function tabTo(page: Page, control: Locator) {
  await control.evaluate((element) => {
    const all = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [tabindex="0"]')]
      .filter((item) => item === element || (!(item as HTMLButtonElement).disabled && item.tabIndex >= 0 && item.getClientRects().length > 0));
    all[all.indexOf(element as HTMLElement) - 1]?.focus();
  });
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
}

const same = (a: Look, b: Look, what: string) => {
  for (const key of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(a[key] - b[key]), `${what}: ${key} moved`).toBeLessThanOrEqual(0.5);
};

for (const theme of ['light', 'dark'] as const) {
  test(`P0022 every interaction state reads differently and holds its place in ${theme}`, async ({ page }) => {
    const gallery = await open(page, theme, 1280);
    const button = (name: string) => gallery.getByRole('button', { name, exact: true });

    // default, hover, focus, pressed on a plain action and the primary action
    for (const name of ['Default', 'Primary']) {
      const control = button(name);
      await control.scrollIntoViewIfNeeded();
      await page.mouse.move(1, 1);
      const rest = await look(control);
      await control.hover();
      const hover = await look(control);
      await page.mouse.move(1, 1);
      await tabTo(page, control);
      const focus = await look(control);
      const box = (await control.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const pressed = await look(control);
      await page.mouse.up();
      await page.mouse.move(1, 1);
      for (const [state, shot] of Object.entries({ hover, focus, pressed })) {
        same(rest, shot, `${theme} ${name} ${state}`);
        expect(shot.paint, `${theme} ${name}: ${state} looks like rest`).not.toBe(rest.paint);
      }
    }

    // selected: the toggle and the tab
    const toggle = button('Toggle selection');
    const toggleRest = await look(toggle);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(1, 1);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const toggleOn = await look(toggle);
    same(toggleRest, toggleOn, `${theme} selected toggle`);
    expect(toggleOn.paint, `${theme}: selected toggle looks like rest`).not.toBe(toggleRest.paint);
    await toggle.click();

    const tabs = gallery.getByRole('tablist', { name: 'Example tabs' });
    const chosen = await look(tabs.getByRole('tab', { selected: true }));
    const other = await look(tabs.getByRole('tab', { name: 'Second' }));
    expect(chosen.paint, `${theme}: selected tab looks like the others`).not.toBe(other.paint);

    // disabled and busy against default
    const rest = await look(button('Default'));
    const disabled = await look(button('Disabled'));
    expect(disabled.paint, `${theme}: disabled looks like default`).not.toBe(rest.paint);
    await expect(button('Disabled')).toBeDisabled();
    const busy = button('Working');
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    const bar = await busy.evaluate((element) => getComputedStyle(element, '::after').content);
    expect(bar, `${theme}: busy shows no working bar`).not.toBe('none');

    // error: the invalid field is marked and differs from a valid one, with its reason in words
    const invalid = gallery.getByRole('textbox', { name: 'Invalid field' });
    await expect(invalid).toHaveAttribute('aria-invalid', 'true');
    await expect(invalid).toHaveAccessibleDescription(/Choose a value between 1 and 10/);
    const valid = await look(gallery.getByRole('searchbox', { name: 'Search' }));
    expect((await look(invalid)).paint, `${theme}: invalid looks valid`).not.toBe(valid.paint);

    // success and failure statuses: different colour AND different words and mark
    const statuses = await gallery.locator('.status').evaluateAll((items) => items.map((item) => ({ text: item.textContent?.trim() ?? '', icon: !!item.querySelector('svg'), colour: getComputedStyle(item).color })));
    expect(statuses.length, `${theme}: statuses`).toBeGreaterThanOrEqual(8);
    expect(new Set(statuses.map((item) => item.text)).size, `${theme}: two statuses share words`).toBe(statuses.length);
    for (const item of statuses) expect(item.icon && item.text.length > 0, `${theme}: ${item.text} has no mark or words`).toBe(true);

    // success after work: Save goes busy and comes back with a confirmation
    const save = gallery.locator('section').first().locator('button:has(> .action-labels)');
    const saveRest = await look(save);
    await save.click();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    same(saveRest, await look(save), `${theme} Save while busy`);
    await expect(gallery.getByText('Saved locally for this demonstration.')).toBeVisible();
  });

  test(`P0022 long labels stay inside a 320px screen in ${theme}`, async ({ page }) => {
    const gallery = await open(page, theme, 320);
    const found = await gallery.evaluate((root) => {
      const room = document.documentElement.clientWidth;
      const pick = (selector: string) => root.querySelector<HTMLElement>(selector)!;
      const long = {
        tab: [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.includes('A longer third tab'))!,
        badge: [...root.querySelectorAll<HTMLElement>('.pill')].find((pill) => pill.textContent?.includes('A longer badge label'))!,
        song: pick('.song-row .song-name'),
        save: pick('section button:has(> .action-labels)'),
      };
      return {
        overflow: document.documentElement.scrollWidth - room,
        parts: Object.entries(long).map(([name, element]) => {
          const rect = element.getBoundingClientRect();
          return { name, left: rect.left, right: rect.right, cut: element.scrollWidth - element.clientWidth };
        }),
        room,
      };
    });
    expect(found.overflow, `${theme}: the page scrolls sideways`).toBeLessThanOrEqual(0);
    for (const part of found.parts) {
      expect(part.left, `${theme}: ${part.name} starts off screen`).toBeGreaterThanOrEqual(-0.5);
      expect(part.right, `${theme}: ${part.name} runs off screen`).toBeLessThanOrEqual(found.room + 0.5);
      if (part.name !== 'save') expect(part.cut, `${theme}: ${part.name} words cut off`).toBeLessThanOrEqual(1);
    }
    // the Save action's longer working label never changes its box
    const save = gallery.locator('section').first().locator('button:has(> .action-labels)');
    const before = await look(save);
    await save.click();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    same(before, await look(save), `${theme} 320px Save while busy`);
  });
}
