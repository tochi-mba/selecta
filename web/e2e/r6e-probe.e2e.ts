import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resetMix } from './helpers';

test('r6e probe', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.clock.setFixedTime(new Date('2026-11-10T12:00:00Z'));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/mixes');
  await page.evaluate(() => localStorage.setItem('selecta.prefs', JSON.stringify({ theme: 'light', motion: 'still' })));
  for (let run = 0; run < 3; run += 1) {
    await resetMix(request);
    await page.goto('/library');
    await expect(page.locator('.library-rows .song-row').first()).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForTimeout(250);
    writeFileSync(`C:/Users/tochi/AppData/Local/Temp/claude/3ec60e2294e4cf87/30c7424d-04ce-46d7-abd9-1ca76811fedf/scratchpad/r6e/shot${run}.png`, await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }));
    writeFileSync(`C:/Users/tochi/AppData/Local/Temp/claude/3ec60e2294e4cf87/30c7424d-04ce-46d7-abd9-1ca76811fedf/scratchpad/r6e/dom${run}.html`, await page.content());
  }
});
