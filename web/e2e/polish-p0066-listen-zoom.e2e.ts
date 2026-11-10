import { expect, test, type Page } from '@playwright/test';
import { allRendered, resetMix, spyOnAudio } from './helpers';

/**
 * Polish ADR-0039 P0066: the song strip's seek and seam marker, and the countdown's units, keep a
 * text (not colour-only) cue and stay usable at normal size and at 200% and 400% zoom
 * (a 1280x1024 window at 200% is 640x512 CSS pixels, at 400% it is 320x256).
 */
const SIZES = [[1440, 900, 'normal'], [640, 512, '200%'], [320, 256, '400%']] as const;

async function playAt(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/listen');
  const play = page.locator('.now .transport .primary');
  await play.click();
  await expect(play).toHaveText('Pause', { timeout: 30_000 });
}

test.beforeEach(async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await spyOnAudio(page);
  await resetMix(request);
  await allRendered(request);
});

test('P0066 seek, seam marker and countdown units read in words at normal size, 200% and 400%', async ({ page }) => {
  for (const [width, height, zoom] of SIZES) {
    await playAt(page, width, height);
    const strip = page.getByRole('slider', { name: 'Where in the song' });
    await strip.scrollIntoViewIfNeeded();
    await expect(strip, `${zoom}: strip`).toBeVisible();
    const read = await page.evaluate(() => {
      const slider = document.querySelector<HTMLElement>('.strip')!;
      const box = slider.getBoundingClientRect();
      const seam = slider.querySelector<HTMLElement>('.seam-mark');
      const countdown = document.querySelector<HTMLElement>('.handoff.countdown, .handoff.pending');
      return {
        valuetext: slider.getAttribute('aria-valuetext'),
        left: box.left, right: box.right, height: box.height,
        seamTitle: seam?.title ?? null,
        countdownLabel: countdown?.getAttribute('aria-label') ?? null,
        countdownText: countdown && countdown.getBoundingClientRect().width > 0 ? countdown.textContent : null,
        scroll: document.documentElement.scrollWidth,
      };
    });
    expect(read.valuetext, `${zoom}: the position is said in time`).toMatch(/\d+:\d{2} of \d+:\d{2}/);
    expect(read.left, `${zoom}: strip starts on screen`).toBeGreaterThanOrEqual(-1);
    expect(read.right, `${zoom}: strip ends on screen`).toBeLessThanOrEqual(width + 1);
    expect(read.height, `${zoom}: strip has a usable height`).toBeGreaterThanOrEqual(24);
    expect(read.scroll, `${zoom}: no sideways scroll`).toBeLessThanOrEqual(width);
    if (read.seamTitle !== null) expect(read.seamTitle, `${zoom}: seam marker says when`).toMatch(/^Seam at \d+:\d{2}$/);
    if (read.countdownLabel !== null) expect(read.countdownLabel, `${zoom}: countdown names its unit`).toMatch(/bars|beats|transition/);
    if (read.countdownText !== null) expect(read.countdownText, `${zoom}: visible countdown names its unit`).toMatch(/bars to transition|beats to transition|minutes and seconds|Transition/);
    // the keyboard moves the playhead without the mouse
    await strip.focus();
    const before = await strip.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Number(await strip.getAttribute('aria-valuenow')), { message: `${zoom}: arrow key seeks` }).not.toBe(Number(before));
    await page.locator('.now .transport .primary').click();
  }
});
