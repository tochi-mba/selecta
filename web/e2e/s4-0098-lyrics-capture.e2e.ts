import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetMix, rewriteJson } from './helpers';

/**
 * S4-0098-04 lyric typography, active line and auto-scroll in Edge, with a lyric fixture that mixes
 * Arabic, Hebrew, a long wrapping line, mixed-direction and CJK lines (served for song 1 through a
 * rewritten /api/songs/1). Measures, from the real stylesheet: each line resolves its own direction,
 * the sung line is whole on screen and never sticks out, and the lyric block keeps its height as the
 * active line moves, so nothing below it jumps. Captures for a person to review are attached to the
 * test (light and dark, 375 and 1440 px). Capturing them is not a review of them.
 */
const LONG = 'a lyric line long enough to wrap across the whole stage at every width, and then some more';
const LINES = [
  { start: 0.2, end: 1.6, text: 'مرحبا بالليل الطويل' },
  { start: 1.8, end: 3.2, text: 'שלום לך עולם הלילה' },
  { start: 3.4, end: 4.8, text: LONG },
  { start: 5.0, end: 6.4, text: 'Mixed English و عربي together' },
  { start: 6.6, end: 8.0, text: '夜の音楽が流れる街' },
  { start: 8.2, end: 9.6, text: 'the last line in English' },
];

async function withFixture(page: Page) {
  await page.route('**/api/songs/1', (route) => rewriteJson(route, (body) => ({ ...body, lyric_status: 'synced', lines: LINES })));
}

async function sample(page: Page) {
  return page.evaluate(() => {
    const block = document.querySelector('.lyrics') as HTMLElement | null;
    if (!block) return null;
    const sung = block.querySelector('p.sung') as HTMLElement | null;
    const box = sung?.getBoundingClientRect();
    return {
      height: Math.round(block.getBoundingClientRect().height),
      sung: sung?.textContent ?? null,
      direction: sung ? getComputedStyle(sung).direction : null,
      sticksOut: sung ? sung.scrollWidth - sung.clientWidth : 0,
      offscreen: box ? box.left < -1 || box.right > window.innerWidth + 1 : false,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

for (const width of [375, 1440] as const) {
  test(`S4-0098-04 RTL, long and CJK lyric lines stay whole, set their direction and never jump, at ${width}px`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await withFixture(page);
    await page.goto('/listen');
    await page.getByRole('button', { name: /^(Play|Resume from)/ }).first().click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeVisible();
    await expect(page.locator('.lyrics p.sung')).toHaveText(LINES[0].text, { timeout: 20_000 });

    const seen: NonNullable<Awaited<ReturnType<typeof sample>>>[] = [];
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const now = await sample(page);
      if (now) seen.push(now);
      await page.waitForTimeout(250);
    }
    const sungLines = [...new Set(seen.map((reading) => reading.sung).filter(Boolean))];
    const heights = [...new Set(seen.map((reading) => reading.height))];
    console.log(`S4-0098-04 ${JSON.stringify({ width, sungLines, heights, samples: seen.length })}`);
    expect(sungLines.length, 'the active line did not move through the fixture').toBeGreaterThanOrEqual(4);
    expect(Math.max(...heights) - Math.min(...heights), 'the lyric block changed height as lines changed').toBeLessThanOrEqual(2);
    for (const reading of seen) {
      expect(reading.sticksOut, `"${reading.sung}" sticks out of its line`).toBeLessThanOrEqual(1);
      expect(reading.offscreen, `"${reading.sung}" is off screen`).toBe(false);
      expect(reading.overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
      if (reading.sung && /^[֐-ۿ]/.test(reading.sung)) expect(reading.direction, `"${reading.sung}"`).toBe('rtl');
      if (reading.sung && /^[a-z夜]/i.test(reading.sung)) expect(reading.direction, `"${reading.sung}"`).toBe('ltr');
    }

    // captures for the visual review, both themes, paused where the fixture has got to
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await page.waitForTimeout(200);
      const shot = await page.locator('.lyrics').first().screenshot();
      await info.attach(`s4-0098-04-lyrics-${width}-${scheme}.png`, { body: shot, contentType: 'image/png' });
      // S4_CAPTURE_DIR keeps the captures for review outside test-results, which is thrown away
      const keep = process.env.S4_CAPTURE_DIR;
      if (keep) {
        mkdirSync(keep, { recursive: true });
        writeFileSync(join(keep, `s4-0098-04-lyrics-${width}-${scheme}.png`), shot);
      }
    }
  });
}
