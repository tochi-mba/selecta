import { expect, test } from '@playwright/test';

/**
 * S3-0051-07: the shared component gallery (web/src/ui/ControlGallery.tsx, Workspace > Diagnostics) as
 * fixtures across both themes, both motion preferences, phone, tablet and desktop widths, with its error
 * states shown. Needs a site built with VITE_SELECTA_GALLERY=1 (as web/e2e/mp-0279-component-gallery.e2e.ts
 * does). Each combination is attached as a full-gallery screenshot for a visual reviewer; capturing them is
 * not approval.
 */
const THEMES = ['light', 'dark'] as const;
const MOTIONS = ['reduce', 'no-preference'] as const;
const WIDTHS = [320, 768, 1440] as const;

for (const theme of THEMES) {
  for (const motion of MOTIONS) {
    test(`S3-0051-07 gallery fixture in ${theme} with ${motion} motion at every width`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: motion });
      const backgrounds = new Set<string>();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/workshop/diagnostics');
        const gallery = page.locator('details.control-gallery');
        await expect(gallery, 'build the site with VITE_SELECTA_GALLERY=1 for this spec').toHaveCount(1);
        await gallery.evaluate((details) => { (details as HTMLDetailsElement).open = true; });
        await expect(gallery.getByRole('heading', { name: 'Overlays and recovery' })).toBeVisible();
        await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
        const where = `${theme}, ${motion}, ${width}px`;

        // the page follows the requested theme: the default preference matches the computer, so no
        // manual theme is set (data-theme stays off, as finishing.e2e.ts expects) and the computer's is this one
        expect(await page.evaluate(() => document.documentElement.dataset.theme ?? 'system'), where).toBe('system');
        expect(await page.evaluate((scheme) => matchMedia(`(prefers-color-scheme: ${scheme})`).matches, theme), where).toBe(true);
        backgrounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

        // error states: an invalid field with its reason bound, a failed load with a retry, a failed status
        const invalid = gallery.getByRole('textbox', { name: 'Invalid field' });
        await expect(invalid, where).toHaveAttribute('aria-invalid', 'true');
        await expect(invalid, where).toHaveAccessibleDescription(/Choose a value between 1 and 10/);
        const problem = gallery.getByRole('alert').filter({ hasText: 'could not be loaded' });
        await expect(problem, where).toBeVisible();
        await expect(problem.getByRole('button'), where).toBeVisible();
        await expect(gallery.locator('.status.status-failed'), where).toBeVisible();

        // nothing in the gallery runs off the side of the page at this width
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${where}: horizontal page scroll`).toBeLessThanOrEqual(0);
        const sticking = await gallery.evaluate((root) => {
          const edge = document.documentElement.clientWidth;
          return [...root.querySelectorAll<HTMLElement>('button, input, select, .status, .pill, .card, [role="alert"]')]
            .filter((element) => element.offsetParent !== null && !element.closest('[role="tablist"]'))
            .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
            .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? element.tagName);
        });
        expect(sticking, `${where}: controls past the right edge`).toEqual([]);

        // reduced motion leaves nothing animating by itself
        if (motion === 'reduce') {
          const moving = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length);
          expect(moving, `${where}: animations still running`).toBe(0);
        }

        // an overlay opens, Escape closes it and focus goes back to the button that opened it
        const opener = gallery.getByRole('button', { name: 'Open dialog' });
        await opener.click();
        await expect(page.getByRole('dialog', { name: 'Example dialog' }), where).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'Example dialog' }), where).toHaveCount(0);
        await expect(opener, where).toBeFocused();

        await info.attach(`gallery-${theme}-${motion}-${width}.png`, { body: await gallery.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
      }
      expect(backgrounds.size, `${theme}: one page background at every width`).toBe(1);
    });
  }
}

test('S3-0051-07 the light and dark fixtures really are different themes', async ({ page }) => {
  const shown: Record<string, string> = {};
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/workshop/diagnostics');
    await expect(page.locator('details.control-gallery')).toHaveCount(1);
    shown[theme] = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  }
  expect(shown.light).not.toBe(shown.dark);
});
