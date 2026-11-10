import { expect, Page, test } from '@playwright/test';
import { audioClock, resetMix, soundsStarted, spyOnAudio } from './helpers';

/**
 * ADR-0270 (docs/engineering/layer-precedence.md), in a real browser:
 *   FP-0270-05  hiding the mini-player for the software keyboard or the Stage is visual only: it never
 *               pauses, restarts, seeks or hands the audio to someone else.
 *   FP-0270-07  with a phone's bottom safe area reserved, and in a short landscape window, the actions
 *               that save, close, cancel and change a selection stay on screen and are the topmost
 *               thing under the pointer, in Light and in Dark.
 * Emulation only: real notches and real software keyboards still need a person with a device.
 */

test.beforeEach(async ({ request }) => resetMix(request));

/** the element under the centre of `name`'s box is that control, not a bar or notice painted over it */
async function uncovered(page: Page, button: ReturnType<Page['getByRole']>) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  return button.evaluate((node) => {
    const box = node.getBoundingClientRect();
    if (box.bottom > innerHeight + 0.5 || box.top < -0.5) return `outside the viewport (${Math.round(box.top)}-${Math.round(box.bottom)} of ${innerHeight})`;
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top === node || node.contains(top) ? null : `covered by ${top?.tagName.toLowerCase()}.${top?.className}`;
  });
}

test('keyboard and Stage hide the mini-player without touching the music (FP-0270-05)', async ({ page }) => {
  await spyOnAudio(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
  await page.getByRole('link', { name: 'Library' }).first().click();
  const mini = page.locator('.mini');
  await expect(mini).toBeVisible();
  const started = await soundsStarted(page);

  for (const flag of ['keyboard', 'stage'] as const) {
    const before = (await audioClock(page))[0];
    await page.evaluate((name) => { document.documentElement.dataset[name] = name === 'keyboard' ? 'open' : 'on'; }, flag);
    await expect(mini).toBeHidden();
    // the clock keeps running while the player is out of sight, and nothing new was started
    await expect.poll(async () => (await audioClock(page))[0], { message: `${flag}: clock` }).toBeGreaterThan(before + 0.3);
    expect(await soundsStarted(page), `${flag}: no restart`).toBe(started);
    await page.evaluate((name) => { delete document.documentElement.dataset[name]; }, flag);
    await expect(mini).toBeVisible();
    await expect(mini).toHaveAttribute('aria-label', /Now playing|Playing transition/);
    expect(await soundsStarted(page), `${flag}: no restart on return`).toBe(started);
  }
});

for (const view of [
  { name: 'phone with a 34px bottom safe area', width: 375, height: 667, safe: '34px' },
  { name: 'short phone landscape', width: 667, height: 320, safe: '21px' },
  { name: 'short desktop landscape', width: 1280, height: 600, safe: '0px' },
]) {
  test(`save, close, cancel and selection actions stay reachable: ${view.name} (FP-0270-07)`, async ({ page }, info) => {
    await page.setViewportSize({ width: view.width, height: view.height });
    for (const theme of ['light', 'dark'] as const) {
      await page.goto('/mixes');
      await page.evaluate(({ chosen, safe }) => {
        localStorage.setItem('selecta.prefs', JSON.stringify({ theme: chosen, motion: 'still' }));
        sessionStorage.setItem('fp-safe', safe);
      }, { chosen: theme, safe: view.safe });
      await page.addInitScript(() => {
        const safe = sessionStorage.getItem('fp-safe');
        if (safe) document.documentElement.style.setProperty('--safe-bottom', safe);
      });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      // save and close in a dialog
      await page.getByRole('button', { name: 'Customize' }).click();
      const dialog = page.getByRole('dialog', { name: 'Shape the next mix' });
      await expect(dialog).toBeVisible();
      expect(await uncovered(page, dialog.getByRole('button', { name: 'Done shaping' })), `${theme} Done shaping`).toBeNull();
      await page.screenshot({ path: info.outputPath(`fp-0270-07-${view.width}x${view.height}-${theme}-dialog.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      // cancel in a confirmation
      await page.goto('/library');
      await page.getByRole('checkbox', { name: /^Select recording/ }).first().check();
      const clear = page.getByRole('button', { name: 'Clear selection' });
      expect(await uncovered(page, clear), `${theme} Clear selection`).toBeNull();
      const prioritize = page.getByRole('button', { name: 'Prioritize selected' });
      if (await prioritize.count()) {
        expect(await uncovered(page, prioritize), `${theme} Prioritize selected`).toBeNull();
        await prioritize.click();
        const cancel = page.getByRole('dialog').getByRole('button', { name: 'Cancel' });
        expect(await uncovered(page, cancel), `${theme} Cancel`).toBeNull();
        await page.screenshot({ path: info.outputPath(`fp-0270-07-${view.width}x${view.height}-${theme}-confirm.png`) });
        await cancel.click();
      }
      // the last selectable row can be scrolled clear of the bottom chrome
      const last = page.getByRole('checkbox', { name: /^Select recording/ }).last();
      expect(await uncovered(page, last), `${theme} last row checkbox`).toBeNull();
      await page.evaluate(() => sessionStorage.removeItem('fp-safe'));
    }
  });
}
