import { expect, test, type Page } from '@playwright/test';
import { resetMix, spyOnAudio } from './helpers';

/**
 * SF-0209-02 Redesign desktop transport: at wide and shallow desktop sizes, in both themes, the song's
 * title and artist read as one identity group, and Previous, Play/Pause and Next sit in one row with
 * Play/Pause the single, largest primary. Nothing overlaps or wraps and every control keeps a 44px target.
 * Run with SELECTA_E2E_DIST=dist-flo-b SELECTA_E2E_PORT=9047. The visual judgement stays a person step.
 */
const SIZES = [
  { width: 2560, height: 1080 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 600 },
  { width: 1366, height: 500 },
] as const;
const THEMES = ['light', 'dark'] as const;

async function listen(page: Page, width: number, height: number, theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.goto('/listen');
  await page.evaluate((chosen) => { document.documentElement.dataset.theme = chosen; }, theme);
  await expect(page.locator('.listen-identity h1')).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined))));
}

test.beforeEach(async ({ page, request }) => {
  await spyOnAudio(page);
  await resetMix(request);
});

test('SF-0209-02 identity and song controls stay coherent at wide and shallow desktop sizes in both themes', async ({ page }) => {
  for (const theme of THEMES) {
    for (const { width, height } of SIZES) {
      await listen(page, width, height, theme);
      const where = `${width}x${height} ${theme}`;
      const controls = page.getByRole('group', { name: 'Song controls' });
      await expect(controls, `${where}: one named control group`).toHaveCount(1);
      await expect(controls.getByRole('button')).toHaveCount(3);
      const read = await page.evaluate(() => {
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const identity = document.querySelector('.listen-identity')!;
        const title = identity.querySelector('h1')!;
        const artist = identity.querySelector('.artist')!;
        const row = document.querySelector('.now .transport')!;
        const buttons = [...row.querySelectorAll('button')];
        return {
          identity: box(identity), title: box(title), artist: box(artist), row: box(row),
          titleText: title.textContent ?? '', titleClipped: title.scrollWidth > title.clientWidth + 1,
          buttons: buttons.map((button) => ({ ...box(button), primary: button.classList.contains('primary') })),
          pageScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      // identity: title and artist together, the full title shown, the transport below the group
      expect(read.titleText.trim().length, `${where}: a title`).toBeGreaterThan(0);
      expect(read.titleClipped, `${where}: the title is never cut off`).toBe(false);
      expect(read.artist.top, `${where}: artist under the title`).toBeGreaterThanOrEqual(read.title.bottom - 1);
      expect(read.artist.top - read.title.bottom, `${where}: artist stays with its title`).toBeLessThanOrEqual(48);
      expect(read.row.top, `${where}: controls below the identity`).toBeGreaterThanOrEqual(read.identity.bottom - 1);
      // controls: one row, one primary that leads, 44px targets, no overlap
      const [previous, play, next] = read.buttons;
      expect(read.buttons.filter((button) => button.primary), `${where}: one primary`).toHaveLength(1);
      expect(play.primary, `${where}: Play/Pause is the primary`).toBe(true);
      for (const button of read.buttons) {
        expect(button.width, `${where}: target width`).toBeGreaterThanOrEqual(44);
        expect(button.height, `${where}: target height`).toBeGreaterThanOrEqual(44);
        expect(Math.abs((button.top + button.bottom) / 2 - (play.top + play.bottom) / 2), `${where}: one row`).toBeLessThanOrEqual(1);
      }
      expect(play.width * play.height, `${where}: Play is largest`).toBeGreaterThan(previous.width * previous.height);
      expect(play.width * play.height, `${where}: Play is largest`).toBeGreaterThan(next.width * next.height);
      expect(previous.right, `${where}: Previous clear of Play`).toBeLessThanOrEqual(play.left + 0.5);
      expect(play.right, `${where}: Play clear of Next`).toBeLessThanOrEqual(next.left + 0.5);
      expect(read.pageScroll, `${where}: no sideways scroll`).toBe(false);
    }
  }
});
