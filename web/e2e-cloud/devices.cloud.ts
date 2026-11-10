import { expect, Page, test } from '@playwright/test';
import { playingAudio } from './helpers';

// SC-0415-01, -03 and -05: devices are listed, renamed and signed out, the eleventh signs out
// the oldest with a notice; "Play here" moves playback between two browsers without the two
// ever playing at once; remotes steer the speaker; an iPhone is told to keep its screen on.

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function rename(page: Page, to: string) {
  const row = page.getByTestId('device-row').filter({ has: page.locator('.devices-this') });
  await row.getByRole('button', { name: /^Rename/ }).click();
  await page.getByLabel('Device name').fill(to);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('device-row').filter({ hasText: to })).toBeVisible();
}

test('Play here moves playback with no double audio, and remotes steer it', async ({ browser }) => {
  const laptopContext = await browser.newContext();
  const phoneContext = await browser.newContext({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const laptop = await laptopContext.newPage();
  const phone = await phoneContext.newPage();
  await laptop.goto('/harness?as=bob&rooms=0');
  await phone.goto('/harness?as=bob&rooms=0');
  await expect(laptop.getByTestId('device-row').filter({ has: laptop.locator('.devices-this') })).toBeVisible();
  await rename(laptop, 'Living-room laptop');
  await expect(phone.getByTestId('device-row').filter({ has: phone.locator('.devices-this') })).toContainText('Safari on iPhone');
  await rename(phone, 'Phone');

  await laptop.getByRole('button', { name: 'Play here' }).click();
  await expect(laptop.getByTestId('playing-where')).toHaveText('Playing here');
  await expect.poll(() => playingAudio(laptop)).toBe(1);
  await expect(phone.getByTestId('playing-where')).toHaveText('Playing on Living-room laptop');

  // The phone takes over: it asks first, says "Starting here...", and the two never overlap.
  await phone.getByRole('button', { name: 'Play here' }).click();
  await expect(phone.getByRole('alertdialog')).toContainText('Playing on Living-room laptop. Play here instead?');
  await expect(phone.getByRole('note')).toHaveText('On iPhone, keep Selecta open with the screen on while it plays.');
  await phone.getByRole('button', { name: 'Play here instead' }).click();
  await expect(phone.getByText('Starting here...')).toBeVisible();
  let most = 0;
  let phonePlaying = false;
  for (let sample = 0; sample < 80 && !(phonePlaying && (await playingAudio(laptop)) === 0 && sample > 40); sample++) {
    const [a, b] = await Promise.all([playingAudio(laptop), playingAudio(phone)]);
    most = Math.max(most, a + b);
    phonePlaying = b === 1;
    await phone.waitForTimeout(100);
  }
  expect(most).toBeLessThanOrEqual(1);
  expect(phonePlaying).toBe(true);
  await expect.poll(() => playingAudio(laptop)).toBe(0);
  await expect(laptop.getByText('Playback moved to Phone')).toBeVisible();
  await expect(laptop.getByTestId('playing-where')).toHaveText('Playing on Phone');
  await expect(phone.getByTestId('playing-where')).toHaveText('Playing here');

  // The laptop is a remote now: its Pause stops the phone.
  await laptop.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => playingAudio(phone), { timeout: 10_000 }).toBe(0);
  await laptop.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => playingAudio(phone), { timeout: 10_000 }).toBe(1);
  await Promise.all([laptopContext.close(), phoneContext.close()]);
});

test('the eleventh device signs out the oldest with a notice, and sign-out works', async ({ browser, request }) => {
  const headers = { Authorization: 'Bearer carol' };
  for (let n = 0; n < 10; n++) {
    const made = await request.post('/api/devices', { headers, data: { name: `Old device ${n}`, kind: 'laptop', device_id: `old-${n}-${Date.now()}` } });
    expect(made.status()).toBe(201);
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/harness?as=carol&rooms=0');
  await expect(page.getByText('so Old device 0 was signed out')).toBeVisible();
  await expect(page.getByTestId('device-row')).toHaveCount(10);
  await expect(page.getByTestId('device-row').filter({ hasText: 'Old device 0' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out Old device 1' }).click();
  await expect(page.getByText('Old device 1 was signed out.')).toBeVisible();
  await expect(page.getByTestId('device-row')).toHaveCount(9);
  await context.close();
});

test('a Free account sees Rooms as a Premium feature', async ({ page }) => {
  await page.goto('/harness?as=carol');
  await expect(page.getByRole('heading', { name: /Rooms/ })).toContainText('Premium');
  await expect(page.getByText('Rooms are part of Premium.')).toBeVisible();
  const refused = await page.request.post('/api/rooms', { headers: { Authorization: 'Bearer carol' }, data: { name: 'Nope' } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).detail.code).toBe('plan_required');
});
