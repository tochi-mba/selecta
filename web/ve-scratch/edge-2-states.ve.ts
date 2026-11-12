import { expect, Page, test } from '@playwright/test';
import { allRendered, out, resetStress, save, setTheme, STRESS_MIX } from './lib';

const CONDITIONS = ['normal', 'forced', 'grayscale'] as const;
type Condition = (typeof CONDITIONS)[number];

async function apply(page: Page, condition: Condition) {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: condition === 'forced' ? 'active' : 'none' });
  if (condition === 'grayscale') await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
}

async function openStudio(page: Page) {
  await page.goto('/mix/current/edit');
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Open the Studio' }).click();
  await expect(page.locator('.studio-cell').first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('group', { name: 'Studio editor mode' }).getByRole('button', { name: 'Detailed grid' }).click().catch(() => undefined);
}

test('Studio selected and solo cells, seam and song states under forced colours and grayscale', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const notes: Record<string, unknown> = {};
  // one planned transition at the end: a song added after the render
  await request.post('/api/mix/songs', { data: { song_id: 3 } });
  for (const theme of ['light', 'dark'] as const) {
    for (const condition of CONDITIONS) {
      await setTheme(page, theme);
      await openStudio(page);
      await apply(page, condition);
      const grid = page.locator('[role="grid"]').first();
      const tabbable = grid.locator('button[tabindex="0"]').first();
      await tabbable.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');
      const focused = await page.evaluate(() => {
        const node = document.activeElement as HTMLElement;
        const style = getComputedStyle(node);
        return { name: node.getAttribute('aria-label') ?? node.textContent, pressed: node.getAttribute('aria-pressed'), outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, shadow: style.boxShadow };
      });
      const solo = page.getByRole('button', { name: /^Hear only / }).first();
      await solo.click();
      const soloState = { name: await solo.getAttribute('aria-label') ?? await solo.innerText(), pressed: await solo.getAttribute('aria-pressed'), text: await solo.innerText() };
      await tabbable.focus().catch(() => undefined);
      await page.evaluate(() => (document.querySelector('[role="grid"] button[aria-pressed="true"]') as HTMLElement | null)?.focus());
      await page.locator('.studio-grid, [role="grid"]').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: out('forced', `studio-${theme}-${condition}.png`), animations: 'disabled' });
      const pressedCells = await grid.locator('button[aria-pressed="true"]').count();
      notes[`studio-${theme}-${condition}`] = { focused, soloState, pressedCells };
      await solo.click();

      await page.goto('/mix/current/edit');
      await apply(page, condition);
      const seams = page.locator('.timeline > .seam');
      await expect(seams.first()).toBeVisible();
      notes[`editor-${theme}-${condition}`] = await seams.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).innerText.trim().replace(/\s+/g, ' ').slice(0, 120)));
      await page.screenshot({ path: out('forced', `editor-${theme}-${condition}.png`), fullPage: true, animations: 'disabled' });

      await page.goto('/library');
      await apply(page, condition);
      await expect(page.locator('.library-count')).toBeVisible();
      const chosen = page.getByRole('button', { name: 'Needs attention' });
      await chosen.click();
      await page.screenshot({ path: out('forced', `library-attention-${theme}-${condition}.png`), animations: 'disabled' });
      notes[`library-${theme}-${condition}`] = await page.locator('ul.library-rows > li').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).innerText.trim().replace(/\s+/g, ' ').slice(0, 120)));
    }
  }
  save('forced-notes.json', notes);
  await resetStress(request, STRESS_MIX);
  await allRendered(request);
});

test('component gallery states in Light and Dark', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const notes: Record<string, unknown> = {};
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await page.goto('/workshop/diagnostics');
    const gallery = page.locator('details.control-gallery');
    await expect(gallery).toHaveCount(1);
    await gallery.evaluate((node) => { (node as HTMLDetailsElement).open = true; });
    await gallery.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await gallery.screenshot({ path: out('gallery', `gallery-${theme}.png`), animations: 'disabled' });
    // hover and keyboard focus on the first real button in the gallery
    const first = gallery.getByRole('button').first();
    await first.hover();
    await gallery.screenshot({ path: out('gallery', `gallery-hover-${theme}.png`), animations: 'disabled' });
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await gallery.screenshot({ path: out('gallery', `gallery-focus-${theme}.png`), animations: 'disabled' });
    notes[theme] = await gallery.evaluate((node) => [...node.querySelectorAll('h2, h3, h4, figcaption, .gallery-label, dt')].map((n) => (n as HTMLElement).innerText.trim()).filter(Boolean).slice(0, 80));
  }
  save('gallery-notes.json', notes);
});

test('sensory: Stage and Listen while playing at default motion, sampled over time', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const notes: Record<string, unknown> = {};
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
    await page.goto('/mixes');
    await page.evaluate((chosen) => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen })), theme);
    await page.goto('/listen');
    const button = page.locator('.now .transport .primary');
    await button.click();
    await expect(button).toHaveText('Pause', { timeout: 30_000 });
    notes[`motion-${theme}`] = await page.evaluate(() => document.documentElement.dataset.motion);
    for (let i = 0; i < 12; i += 1) {
      await page.screenshot({ path: out('sensory', `listen-${theme}-${String(i).padStart(2, '0')}.png`), scale: 'css' });
      await page.waitForTimeout(150);
    }
    await page.locator('[data-stage-launcher]').evaluate((node) => {
      for (let up = node.parentElement; up; up = up.parentElement) if (up.tagName === 'DETAILS') (up as HTMLDetailsElement).open = true;
    });
    await page.locator('[data-stage-launcher]').click();
    await expect(page.locator('.stage-controls')).toBeVisible();
    await page.waitForTimeout(1000);
    for (let i = 0; i < 20; i += 1) {
      await page.screenshot({ path: out('sensory', `stage-${theme}-${String(i).padStart(2, '0')}.png`), scale: 'css' });
      await page.waitForTimeout(100);
    }
    notes[`stage-${theme}-lyrics`] = await page.locator('body').evaluate(() => [...document.querySelectorAll('[class*="lyric"]')].map((n) => (n as HTMLElement).innerText.trim()).filter(Boolean).slice(0, 6));
    await page.keyboard.press('Escape');
    await page.goto('about:blank');
  }
  save('sensory-notes.json', notes);
});
