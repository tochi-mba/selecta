import { expect, test } from '@playwright/test';
import { resetMix } from '../e2e/helpers';
import { settle, shot, STRESS_MIX, writeJson } from './shared';

test.beforeAll(async ({ request }) => { await resetMix(request, STRESS_MIX); });

test('extra: backend down, slow server double press, narrow keyboard focus', async ({ page, request }) => {
  const report: Record<string, unknown> = {};
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });

  // Backend unavailable: every API call refused, as when the local server is stopped.
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    await page.goto('/listen');
    await page.waitForTimeout(4000);
    await shot(page, 'devices', 'backend-down-listen');
    report.backendDown = { text: (await page.locator('body').innerText()).slice(0, 800), offlineClaim: /offline playback|playing offline/i.test(await page.locator('body').innerText()) };
    await page.unroute('**/api/**');
    await page.waitForTimeout(8000);
    report.backendBack = { text: (await page.locator('body').innerText()).slice(0, 400) };
  } catch (error) { report.backendDown = { error: String(error).slice(0, 300) }; }

  // Slow server: press Move down twice fast; count what reaches the server and what the page says.
  try {
    await resetMix(request, STRESS_MIX);
    await page.goto('/mix/current/edit'); await settle(page);
    const sent: string[] = [];
    await page.route('**/api/mix/**', async (route) => {
      if (route.request().method() !== 'GET') { sent.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); await new Promise((r) => setTimeout(r, 3000)); }
      await route.fallback();
    });
    const down = page.getByRole('button', { name: /^Move .* down$/ }).first();
    const label = await down.getAttribute('aria-label');
    await down.click();
    const busy = { disabled: await down.isDisabled().catch(() => null), ariaBusy: await page.locator('[aria-busy="true"]').count() };
    await down.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(7000);
    await shot(page, 'devices', 'slow-server-double-press');
    report.slowDouble = { label, busy, sent, focus: await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName) };
    await page.unroute('**/api/mix/**');
  } catch (error) { report.slowDouble = { error: String(error).slice(0, 300) }; }

  // Narrow screen with a field focused: is the field visible and what happens to the chrome.
  try {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/library'); await settle(page);
    const search = page.getByRole('searchbox').first();
    await search.focus();
    await page.setViewportSize({ width: 320, height: 300 }); // a soft keyboard taking the lower half
    await page.waitForTimeout(600);
    await page.keyboard.type('Same');
    await page.waitForTimeout(800);
    const box = await search.boundingBox();
    await shot(page, 'devices', 'narrow-keyboard-library');
    report.narrowKeyboard = { box, visible: !!box && box.y >= 0 && box.y + box.height <= 300, focused: await search.evaluate((el) => el === document.activeElement) };
  } catch (error) { report.narrowKeyboard = { error: String(error).slice(0, 300) }; }
  writeJson('devices', 'extra.json', report);
});
