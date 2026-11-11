import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetMix, soundsRestarted, spyOnAudio } from './helpers';

/**
 * EX-0116-04: Stage in both themes, with reduced motion, at the smallest phone size and at
 * 400% zoom (1280px / 4 = 320 CSS px): the lyrics pass the automatic contrast and accessibility
 * checks, nothing spills sideways, the way out stays on screen and the music never stops.
 * Fullscreen itself is refused in headless Edge, so this is also the denied-fullscreen case.
 */
const playButton = (page: Page) => page.locator('.now .transport .primary');

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`EX-0116-04 Stage in ${colorScheme} at 320px keeps lyrics readable and the way out reachable`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await spyOnAudio(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/listen');
    await expect(page.locator('.lyrics')).toBeVisible();
    await playButton(page).click();
    await expect(playButton(page)).toHaveText('Pause', { timeout: 30_000 });
    const started = await soundsRestarted(page);
    await page.keyboard.press('f');
    await expect(page.locator('.now.stage')).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).include('.now.stage')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(violations.flatMap((problem) => problem.nodes.map((node) => `${problem.id}: ${String(node.target)}`))).toEqual([]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const exit = page.getByRole('button', { name: 'Exit fullscreen' });
    await expect(exit).toBeInViewport();
    await exit.click();
    await expect(page.locator('.now.stage')).toHaveCount(0);
    await expect(playButton(page)).toHaveText('Pause');
    await expect(playButton(page)).toBeInViewport();
    expect(await soundsRestarted(page), 'nothing restarted').toBe(started);
  });
}
