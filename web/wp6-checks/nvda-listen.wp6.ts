// wp6- TEMPORARY headed NVDA session for T0135 (Listen notices). Made-up library only. Deleted after use.
import { expect, test } from '@playwright/test';
import { allRendered, resetMix, rewriteJson } from '../e2e/helpers';
import { focused, mark, press, readBlock, recorder, settle, wakeNvda } from './shared';

const rec = recorder('nvda-listen');

function holdSeams(status: 'queued' | 'failed') {
  return (body: any) => {
    for (const item of body.mix ?? []) {
      if (item.seam?.state) {
        item.seam.state = { key: item.seam.state.key, status, passed: false };
      }
    }
    return body;
  };
}

test('T0135 listen notices under NVDA', async ({ page, request }) => {
  test.setTimeout(900_000);
  await resetMix(request, [1, 2, 3, 4]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/listen');
  await wakeNvda(page);

  // 1. a transition not made yet: the explanatory fallback is read
  await rec.step('queued', async () => {
    await page.route('**/api/mix', (route) => (route.request().method() === 'GET' ? rewriteJson(route, holdSeams('queued')) : route.continue()));
    await page.route('**/api/seams/*', (route) => (route.request().method() === 'GET'
      ? rewriteJson(route, (s: any) => ({ key: s.key, status: 'queued', passed: false })) : route.continue()));
    await page.goto('/listen'); await settle(page);
    await mark(page, 'one transition not made yet');
    await readBlock(page, '.transition-truth', 7000);
    rec.notes.queuedText = await page.locator('.transition-truth').first().innerText();
  });

  // 2. nothing ready in time: the player's fade notice is a polite status message
  await rec.step('fade', async () => {
    await mark(page, 'two play to the end with no transition ready');
    await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.waitForTimeout(3000);
    const strip = page.getByRole('slider', { name: 'Where in the song' });
    await strip.focus(); await page.waitForTimeout(1500);
    await press(page, 'End', 1, 500);
    const notice = page.getByText('That seam wasn’t ready in time, so this one faded in.');
    await expect(notice).toBeVisible({ timeout: 60_000 });
    rec.notes.fadeNoticeRole = await notice.getAttribute('role');
    rec.notes.fadeFocus = await focused(page);
    await page.waitForTimeout(6000);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(1500);
  });

  // 3. a transition that could not be made: the fallback words are read
  await rec.step('failed', async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/api/mix', (route) => (route.request().method() === 'GET' ? rewriteJson(route, holdSeams('failed')) : route.continue()));
    await page.route('**/api/seams/*', (route) => (route.request().method() === 'GET'
      ? rewriteJson(route, (s: any) => ({ key: s.key, status: 'failed', passed: false })) : route.continue()));
    await resetMix(request, [1, 2, 3, 4]);
    await page.goto('/listen'); await settle(page);
    await mark(page, 'three transition could not be made');
    await readBlock(page, '.transition-truth', 7000);
    rec.notes.failedText = await page.locator('.transition-truth').first().innerText();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // 4. a played transition can be rated; the rating's answer is announced
  await rec.step('rating', async () => {
    await resetMix(request, [1, 2, 3, 4]);
    await allRendered(request);
    await page.goto('/listen'); await settle(page);
    await page.getByRole('button', { name: /^(Play|Resume from)/ }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.waitForTimeout(8000);
    const dj = page.getByText('DJ controls', { exact: true });
    if (await dj.count()) await dj.first().click();
    await page.getByRole('button', { name: 'Jump to the transition' }).click();
    await mark(page, 'four jumped to the transition');
    await expect(page.getByText('Morning Light', { exact: true }).first()).toBeVisible();
    const group = page.getByRole('group', { name: 'Rate that transition' });
    await expect(group).toBeVisible({ timeout: 150_000 });
    await mark(page, 'four b rate the transition');
    await group.getByRole('button', { name: 'Good' }).focus(); await page.waitForTimeout(2500);
    await press(page, 'Enter', 1, 5000);
    rec.notes.afterRate = await focused(page);
    await page.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {});
  });
  await mark(page, 'end');
  rec.save();
  expect(rec.errors).toEqual({});
});
