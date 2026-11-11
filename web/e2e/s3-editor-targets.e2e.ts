import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

/** S3-0057-02: every place a song can be added in Edit is a real target for a finger or a pointer,
 * and names exactly where the song will land. Measured in a real browser at phone and desktop width. */

test.beforeEach(async ({ request }) => resetMix(request));

for (const [width, height] of [[375, 812], [1440, 900]]) {
  test(`insertion targets are at least 24px and say where the song goes, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/mix/current/edit');
    const targets = page.getByRole('button', { name: /^Add a song after / });
    await expect(targets.first()).toBeVisible();
    const count = await targets.count();
    expect(count).toBeGreaterThan(1);
    const places: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const target = targets.nth(index);
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box, `target ${index} at ${width}`).not.toBeNull();
      expect(box!.width, `target ${index} width at ${width}`).toBeGreaterThanOrEqual(24);
      expect(box!.height, `target ${index} height at ${width}`).toBeGreaterThanOrEqual(24);
      const title = (await target.getAttribute('title')) ?? '';
      const place = /as number (\d+)/.exec(title);
      expect(place, `target ${index} title "${title}"`).not.toBeNull();
      places.push(Number(place![1]));
    }
    // each target lands the song one place further along, so no two claim the same spot
    expect(new Set(places).size).toBe(places.length);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });
}
