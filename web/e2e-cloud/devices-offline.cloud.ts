import { expect, Page, test } from '@playwright/test';
import { playingAudio } from './helpers';

// SC-0415-04: a speaker that loses its connection keeps playing from what it has, remotes say it
// is offline and may still be playing, and on reconnect it follows the rules in
// docs/saas/11a-devices-and-rooms.md: if nobody took over it renews its lease and carries on; if
// someone pressed Play here meanwhile, it fades out with "Playback moved to ...".
// The lapse of the 20 s lease is brought forward by /test/expire-lease, so the test stays short.

async function rename(page: Page, to: string) {
  const row = page.getByTestId('device-row').filter({ has: page.locator('.devices-this') });
  await row.getByRole('button', { name: /^Rename/ }).click();
  await page.getByLabel('Device name').fill(to);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('device-row').filter({ hasText: to })).toBeVisible();
}

const clock = (page: Page) => page.evaluate(() => document.querySelector<HTMLAudioElement>('[data-testid="speaker-audio"]')?.currentTime ?? 0);

/** Wait until the speaker is early in a song, so a few offline seconds never cross into the next. */
async function earlyInSong(page: Page) {
  await expect.poll(async () => { const at = await clock(page); return at > 0.2 && at < 3; }, { timeout: 20_000, intervals: [100] }).toBe(true);
}

test('an offline speaker keeps playing, carries on if nobody took over, and fades out if someone did', async ({ browser, request }) => {
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

  // 1. The speaker drops off the network and its lease lapses: the music goes on from what it
  //    has, and the remote says so honestly instead of claiming the music stopped.
  await earlyInSong(laptop);
  await laptopContext.setOffline(true);
  expect((await request.post('/test/expire-lease', { data: { user: 'bob' } })).ok()).toBe(true);
  await expect(phone.getByTestId('playing-where')).toHaveText('Den laptop is offline and may still be playing');
  const before = await clock(laptop);
  await laptop.waitForTimeout(1500);
  expect(await playingAudio(laptop)).toBe(1);
  expect(await clock(laptop)).toBeGreaterThan(before + 1);

  // 2. Nobody took over: on reconnect its next heartbeat renews the lease and it carries on.
  await laptopContext.setOffline(false);
  await expect(phone.getByTestId('playing-where')).toHaveText('Playing on Den laptop', { timeout: 15_000 });
  await expect(laptop.getByTestId('playing-where')).toHaveText('Playing here');
  expect(await playingAudio(laptop)).toBe(1);

  // 3. It drops off again, and this time the remote presses Play here (no question asked,
  //    since the speaker is offline). On reconnect the laptop learns it lost the lease and
  //    fades out, told where the music went, leaving one speaker.
  await earlyInSong(laptop);
  await laptopContext.setOffline(true);
  expect((await request.post('/test/expire-lease', { data: { user: 'bob' } })).ok()).toBe(true);
  await expect(phone.getByTestId('playing-where')).toHaveText('Den laptop is offline and may still be playing');
  await phone.getByRole('button', { name: 'Play here' }).click();
  await expect(phone.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => playingAudio(phone), { timeout: 15_000 }).toBe(1);
  await expect(phone.getByTestId('playing-where')).toHaveText('Playing here');
  await laptopContext.setOffline(false);
  await expect.poll(() => playingAudio(laptop), { timeout: 15_000 }).toBe(0);
  await expect(laptop.getByText('Playback moved to Kitchen tablet')).toBeVisible();
  await expect(laptop.getByTestId('playing-where')).toHaveText('Playing on Kitchen tablet');
  expect(await playingAudio(phone)).toBe(1);

  await Promise.all([laptopContext.close(), phoneContext.close()]);
});
