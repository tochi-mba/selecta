import { expect, Page, test } from '@playwright/test';
import { playingAudio, startDevicesClean } from './helpers';

// BF-0461-04 (ADR-0461): a press for an offline speaker is held, not applied behind its back.
// If the speaker comes back in time the press reaches it; if the press runs out first it is
// dropped, never applied late, and the controller is told what was missed. State only: the
// browsers run muted, and "playing" here means the speaker's audio element, never audibility.
// The 20 s lease lapse and the 60 s press TTL are brought forward by /test/expire-lease and
// /test/expire-held, so the test stays short.

async function rename(page: Page, to: string) {
  const row = page.getByTestId('device-row').filter({ has: page.locator('.devices-this') });
  await row.getByRole('button', { name: /^Rename/ }).click();
  await page.getByLabel('Device name').fill(to);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('device-row').filter({ hasText: to })).toBeVisible();
}

/** The song the bar names, without the running clock. */
const songOn = async (page: Page) => ((await page.locator('.playing-bar-song').textContent()) ?? '').split(' · ')[0];

test('a press for an offline speaker waits for it, and one that runs out is reported missed', async ({ browser, request }) => {
  await startDevicesClean(request, 'bob');
  const laptopContext = await browser.newContext();
  const phoneContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const laptop = await laptopContext.newPage();
  const phone = await phoneContext.newPage();
  await laptop.goto('/harness?as=bob&rooms=0');
  await phone.goto('/harness?as=bob&rooms=0');
  await expect(laptop.getByTestId('device-row').filter({ has: laptop.locator('.devices-this') })).toBeVisible();
  await rename(laptop, 'Den laptop');
  await expect(phone.getByTestId('device-row').filter({ has: phone.locator('.devices-this') })).toBeVisible();
  await rename(phone, 'Kitchen tablet');

  await laptop.getByRole('button', { name: 'Play here' }).click();
  await expect(laptop.getByTestId('playing-where')).toHaveText('Playing here');
  await expect.poll(() => playingAudio(laptop)).toBe(1);
  await expect(phone.getByTestId('playing-where')).toHaveText('Playing on Den laptop');

  // 1. The speaker drops off. A pause pressed now changes nothing yet: it waits, and says so.
  await laptopContext.setOffline(true);
  expect((await request.post('/test/expire-lease', { data: { user: 'bob' } })).ok()).toBe(true);
  await expect(phone.getByTestId('playing-where')).toHaveText('Den laptop is offline and may still be playing');
  await phone.getByRole('button', { name: 'Pause' }).click();
  await expect(phone.getByTestId('presses-waiting')).toHaveText('Waiting for Den laptop to come back: Pause');
  expect(await playingAudio(laptop)).toBe(1);

  // 2. It comes back in time: the held pause is delivered and the speaker stops.
  await laptopContext.setOffline(false);
  await expect.poll(() => playingAudio(laptop), { timeout: 15_000 }).toBe(0);
  await expect(phone.getByTestId('presses-waiting')).toHaveCount(0);
  await expect(phone.getByTestId('presses-missed')).toHaveCount(0);

  // 3. It drops off again. A skip pressed now runs out before it returns: it is dropped, the
  //    song never changes, and the controller is told it was not played.
  await expect(phone.getByTestId('playing-where')).toHaveText('Playing on Den laptop', { timeout: 15_000 });
  const song = await songOn(phone);
  await laptopContext.setOffline(true);
  expect((await request.post('/test/expire-lease', { data: { user: 'bob' } })).ok()).toBe(true);
  await expect(phone.getByTestId('playing-where')).toHaveText('Den laptop is offline and may still be playing');
  await phone.getByRole('button', { name: 'Skip' }).click();
  await expect(phone.getByTestId('presses-waiting')).toHaveText('Waiting for Den laptop to come back: Skip');
  const expired = await request.post('/test/expire-held', { data: { user: 'bob' } });
  expect((await expired.json()).expired).toBe(1);
  await expect(phone.getByTestId('presses-missed')).toContainText('Not played while Den laptop was offline: Skip (waited too long)');
  await laptopContext.setOffline(false);
  await expect(phone.getByTestId('playing-where')).toHaveText('Playing on Den laptop', { timeout: 15_000 });
  await expect(phone.getByTestId('presses-missed')).toContainText('Skip (waited too long)');
  expect(await songOn(phone)).toBe(song);
  expect(await playingAudio(laptop)).toBe(0);

  // The member can put the report away.
  await phone.getByTestId('presses-missed').getByRole('button', { name: 'OK' }).click();
  await expect(phone.getByTestId('presses-missed')).toHaveCount(0);

  await Promise.all([laptopContext.close(), phoneContext.close()]);
});
