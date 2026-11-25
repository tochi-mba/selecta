import { expect, test } from '@playwright/test';
import { endRooms, hostWithRoom, refused, roomOption, said } from './helpers';

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
  await expect(refused(host, "That display code isn't showing anywhere. Check the screen.")).toBeVisible();

  await host.getByLabel('Code on the screen').fill(pairing);
  await host.getByRole('button', { name: 'Pair screen' }).click();
  await expect(said(host, 'Screen paired.')).toBeVisible();

  const qr = screen.locator('#d-qr');
  await expect(qr).toHaveAttribute('data-link', `${baseURL}${joinPath}`, { timeout: 15_000 });
  await expect(qr.locator('svg')).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Garden party' })).toBeVisible();
  await expect(screen.getByText('Scan to request a song')).toBeVisible();
  // no device is playing yet: the screen is led by what's playing, and says nothing is (f3ee73dc)
  await expect(screen.locator('#d-now')).toContainText('Nothing playing yet');
  await expect(screen.locator('#d-upcoming')).toContainText('No requests yet');

  // A guest's request shows up on the big screen.
  const phone = await browser.newContext();
  const guest = await phone.newPage();
  await guest.goto(joinPath);
  await guest.getByRole('button', { name: 'Join the room' }).click();
  await guest.getByLabel("Search the host's songs").fill('Song 7');
  await guest.getByRole('button', { name: 'Choose Song 7 - Artist 0' }).click();
  await guest.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(screen.locator('#d-upcoming')).toContainText('Song 7 - Artist 0', { timeout: 15_000 });

  // A new code: the old one stops working, and the paired screen shows the new QR by itself.
  await roomOption(host, 'Make a new code');
  const ask = host.getByRole('alertdialog', { name: 'Make a new code?' });
  await expect(ask).toContainText('The old QR code stops working the moment the new one exists.');
  await ask.getByRole('button', { name: 'Make a new code', exact: true }).click();
  await expect(said(host, 'New code made')).toBeVisible();
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
  await roomOption(host, 'Close room');
  await host.getByRole('alertdialog', { name: 'Close Garden party?' }).getByRole('button', { name: 'Close room' }).click();
  await expect(screen.getByRole('heading', { name: /has ended/ })).toBeVisible({ timeout: 15_000 });
  await Promise.all([phone.close(), tv.close(), hostContext.close()]);
});
