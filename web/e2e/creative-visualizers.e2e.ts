import { expect, test } from '@playwright/test';
import { resetMix, spyOnAudio, soundsStarted } from './helpers';

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
  const started = await soundsStarted(page);
  const dj = page.locator('details.view-options');
  if (!await dj.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await dj.locator('summary').click();
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
    await expect(page.getByRole('img', { name: label + ' — actual mixed-audio frequency levels' })).toBeVisible();
    await expect(choose).toHaveValue(value);
  }
  expect(await soundsStarted(page)).toBe(started);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Audio frequency visualizer paused' })).toBeVisible();
});
