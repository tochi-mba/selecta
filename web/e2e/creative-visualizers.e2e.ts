import { expect, test } from '@playwright/test';
import { audioClock, resetMix, spyOnAudio, soundsRestarted } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test('measured energy bars use real varied heights rather than collapsing to identical lines', async ({ page }) => {
  await page.goto('/mix/current/edit');
  // A mix under 12 songs folds the overview away above Arrange until it's asked for.
  const toggle = page.getByRole('button', { name: 'Measured song energy' });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  const bars = page.locator('.energy-overview-bar');
  await expect(bars).toHaveCount(4);
  const heights = await bars.evaluateAll((elements) => elements.map((element) =>
    Math.round(element.getBoundingClientRect().height)));
  expect(heights.every((height) => height > 3)).toBe(true);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(25);
  const selected = page.getByRole('button', { name: /song 3, energy/ });
  await selected.click();
  await expect(selected).toHaveAttribute('aria-current', 'true');
});

test('all thirteen additional horizontal visualizers are selectable without restarting real audio', async ({ page }) => {
  await spyOnAudio(page);
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const started = await soundsRestarted(page);
  const dj = page.locator('details.view-options');
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await dj.locator(':scope > summary').click();
  }
  const choose = page.getByRole('combobox', { name: 'Audio visualizer style' });
  for (const [value, label] of [
    ['aurora', 'Aurora contours'],
    ['lanes', 'Spectral lanes'],
    ['constellation', 'Frequency constellation'],
    ['waterfall', 'Recent spectrum'],
    ['skyline', 'Spectrum skyline'],
    ['threads', 'Glass threads'],
    ['pins', 'Signal pins'],
    ['matrix', 'Spectrum mosaic'],
    ['trails', 'Afterglow trails'],
    ['dunes', 'Spectral dunes'],
    ['candles', 'Signal ranges'],
    ['mesh', 'Frequency mesh'],
    ['split', 'Split flow'],
  ]) {
    await choose.selectOption(value);
    await expect(page.getByRole('img', { name: label + ' - actual mixed-audio frequency levels' })).toBeVisible();
    await expect(choose).toHaveValue(value);
  }
  expect(await soundsRestarted(page)).toBe(started);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Audio frequency visualizer paused' })).toBeVisible();
});

// ADR-0185 to ADR-0197 in a real browser: the synthesized library plays through the real
// analyser, so every mode is checked against measured audio, then paused and hidden.
async function countPaints(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { paints: number };
    w.paints = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function counted(...args) {
      if (this.canvas.classList.contains('music-visualizer')) w.paints += 1;
      return clear.apply(this, args);
    };
  });
}
const paints = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { paints: number }).paints);
const litPixels = (page: import('@playwright/test').Page) => page.locator('canvas.music-visualizer').evaluate((node) => {
  const canvas = node as HTMLCanvasElement;
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit += 1;
  return lit;
});

test('the visualizer style is chosen by keyboard and remembered across a reload', async ({ page }) => {
  await page.goto('/listen');
  const dj = page.locator('details.view-options');
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await dj.locator(':scope > summary').click();
  }
  const choose = page.getByRole('combobox', { name: 'Audio visualizer style' });
  await choose.selectOption('split');
  await choose.focus();
  await page.keyboard.press('ArrowUp');
  await expect(choose).toHaveValue('mesh');
  await page.keyboard.press('ArrowUp');
  await expect(choose).toHaveValue('candles');
  await page.reload();
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await dj.locator(':scope > summary').click();
  }
  await expect(page.getByRole('combobox', { name: 'Audio visualizer style' })).toHaveValue('candles');
});

test('each horizontal mode paints measured audio, goes blank on pause and stops while hidden', async ({ page }) => {
  await spyOnAudio(page);
  await countPaints(page);
  await page.goto('/listen');
  await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const dj = page.locator('details.view-options');
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await dj.locator(':scope > summary').click();
  }
  const choose = page.getByRole('combobox', { name: 'Audio visualizer style' });
  for (const value of ['aurora', 'lanes', 'constellation', 'waterfall', 'skyline', 'threads', 'pins',
    'matrix', 'trails', 'dunes', 'candles', 'mesh', 'split']) {
    await choose.selectOption(value);
    await expect.poll(() => litPixels(page), { message: value }).toBeGreaterThan(0);
  }
  // At most 15 frames a second: two seconds of playback is about 30 paints, never 120.
  const before = await paints(page);
  await page.waitForTimeout(2000);
  expect(await paints(page) - before).toBeLessThanOrEqual(34);
  // A background tab: the loop stops, the audio clock keeps running.
  const clock = (await audioClock(page))[0];
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  const hidden = await paints(page);
  await page.waitForTimeout(1000);
  expect(await paints(page)).toBe(hidden);
  expect((await audioClock(page))[0]).toBeGreaterThan(clock + 0.5);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => paints(page)).toBeGreaterThan(hidden);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Audio frequency visualizer paused' })).toBeVisible();
  await expect.poll(() => litPixels(page)).toBe(0);
});
