import { expect, test } from '@playwright/test';
import { record, shot } from './vbkit';

/** S4-0106-03 locale-decimal review: a German-locale Edge typing a comma or a point decimal tempo. */
test.use({ locale: 'de-DE' });

test('S4-0106-03 a comma or point decimal tempo in a de-DE browser', async ({ page }) => {
  const sent: unknown[] = [];
  await page.route('**/api/songs/*/correct', (route) => { sent.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { detail: 'Synthetic refusal so nothing is saved.' } }); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/library?q=Paper');
  await page.getByRole('button', { name: /^Details for Paper Moon/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Paper Moon' });
  await expect(sheet).toBeVisible();
  const box = sheet.getByRole('spinbutton').first();
  const results: Record<string, unknown>[] = [];
  for (const typed of ['120,5', '120.5', '12a', '']) {
    await box.fill('');
    await box.pressSequentially(typed);
    const shown = await box.evaluate((input) => ({ value: (input as HTMLInputElement).value, valid: (input as HTMLInputElement).validity.valid, badInput: (input as HTMLInputElement).validity.badInput }));
    const before = sent.length;
    await sheet.getByRole('button', { name: 'Save correction' }).click().catch(() => undefined);
    await page.waitForTimeout(600);
    const alert = await sheet.locator('[role="alert"]').allTextContents();
    results.push({ typed, ...shown, sent: sent.slice(before), alert, keptInField: await box.inputValue() });
    if (typed === '120,5') await shot(page, 'S4-0106-03', 'tempo-comma-de-DE', sheet);
  }
  record({ task: 'S4-0106-03', locale: 'de-DE', results });
});
