import { expect, test } from '@playwright/test';
import { endRooms, hostWithRoom } from './helpers';

// SC-0416-05: a TV shows a pairing code; once the host types it, the TV shows the room's QR
// code, what's playing and the requests coming up, and it keeps working when the host makes a
// new code. It never plays anything.

test.beforeEach(async ({ page }) => { await endRooms(page); });

test('a paired display shows the room and survives a new code', async ({ browser, baseURL }) => {
  const { context: hostContext, host, joinPath } = await hostWithRoom(browser);
  const tv = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const screen = await tv.newPage();
  await screen.goto('/display');
  await expect(screen.getByRole('heading', { name: 'Pair this screen' })).toBeVisible();
  const pairing = (await screen.locator('#d-pairing').textContent()) ?? '';
  expect(pairing).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);

  // A wrong code is refused and the screen stays unpaired.
  await host.getByLabel('Code on the screen').fill('AAA-AAA');
  await host.getByRole('button', { name: 'Pair screen' }).click();
  await expect(host.locator('.room-error')).toHaveText("That display code isn't showing anywhere. Check the screen.");

  await host.getByLabel('Code on the screen').fill(pairing);
  await host.getByRole('button', { name: 'Pair screen' }).click();
  await expect(host.locator('.room-said')).toHaveText('Screen paired.');

  const qr = screen.locator('#d-qr');
  await expect(qr).toHaveAttribute('data-link', `${baseURL}${joinPath}`, { timeout: 15_000 });
  await expect(qr.locator('svg')).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Garden party' })).toBeVisible();
  await expect(screen.getByText('SCAN TO REQUEST A SONG')).toBeVisible();
  await expect(screen.getByText("The music's paused.")).toBeVisible();
  await expect(screen.locator('#d-upcoming')).toContainText('No requests yet');

  // A guest's request shows up on the big screen.
  const phone = await browser.newContext();
  const guest = await phone.newPage();
  await guest.goto(joinPath);
  await guest.getByRole('button', { name: 'Join the room' }).click();
  await guest.getByLabel("Search the host's songs").fill('Song 7');
  await guest.getByRole('button', { name: 'Request Song 7 - Artist 0' }).click();
  await expect(screen.locator('#d-upcoming')).toContainText('Song 7 - Artist 0', { timeout: 15_000 });

  // A new code: the old one stops working, and the paired screen shows the new QR by itself.
  await host.getByRole('button', { name: 'Make a new code' }).click();
  await expect(host.locator('.room-said')).toContainText('New code made');
  const fresh = (await host.getByTestId('room-code').textContent()) ?? '';
  const freshPath = `/r/${fresh.replace('-', '')}`;
  expect(freshPath).not.toBe(joinPath);
  await expect(qr).toHaveAttribute('data-link', `${baseURL}${freshPath}`, { timeout: 15_000 });
  const old = await screen.request.post('/api/guest/join', { data: { code: joinPath.slice(3) }, headers: { Origin: baseURL ?? '' } });
  expect(old.status()).toBe(404);

  // The display can only read: it holds no audio, and its cookie opens no guest or host route.
  expect(await screen.evaluate(() => document.querySelectorAll('audio, video').length)).toBe(0);
  const viaDisplay = await screen.request.get('/api/rooms/current');
  expect(viaDisplay.status()).toBe(401);

  // Ending the room ends the display.
  await host.getByRole('button', { name: 'End room' }).click();
  await host.getByRole('button', { name: 'End room' }).click();
  await expect(screen.getByRole('heading', { name: /has ended/ })).toBeVisible({ timeout: 15_000 });
  await Promise.all([phone.close(), tv.close(), hostContext.close()]);
});
