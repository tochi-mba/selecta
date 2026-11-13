import { expect, test } from '@playwright/test';
import { endRooms, hostWithRoom } from './helpers';

// ADR-0416 presence fix: the host's panel shows who is really here. A guest who leaves and a
// screen that disconnects drop off the panel on its next 3 s poll with no refresh; a screen the
// host disconnects goes back to its pairing code within one of its own polls; a phone that loses
// the server says "Reconnecting..." and comes back by itself.

test.beforeEach(async ({ page }) => { await endRooms(page); });

test('a guest leaving and a screen disconnecting update the host panel by themselves', async ({ browser }) => {
  const { context: hostContext, host, joinPath } = await hostWithRoom(browser);

  const phone = await browser.newContext();
  const guest = await phone.newPage();
  await guest.goto(joinPath);
  await guest.getByRole('button', { name: 'Join the room' }).click();
  const nickname = ((await guest.locator('#g-head .g-muted').textContent()) ?? '').replace(/^You're (.+?)\. .*$/, '$1');
  const row = host.getByTestId('room-guest').filter({ hasText: nickname });
  await expect(row).toContainText('Here now', { timeout: 5_000 });
  await expect(host.getByTestId('room-guests-heading')).toHaveText('Guests (1 here)');

  // The phone loses the server for a moment: a calm note, then back by itself.
  await phone.setOffline(true);
  await expect(guest.locator('#g-notice')).toHaveText('Reconnecting...', { timeout: 15_000 });
  await phone.setOffline(false);
  await expect(guest.locator('#g-notice')).toHaveText('Back in the room.', { timeout: 20_000 });

  const tv = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const screen = await tv.newPage();
  await screen.goto('/display');
  const pairing = (await screen.locator('#d-pairing').textContent()) ?? '';
  await host.getByLabel('Code on the screen').fill(pairing);
  await host.getByRole('button', { name: 'Pair screen' }).click();
  await expect(screen.locator('#d-qr')).toBeVisible({ timeout: 15_000 });
  await expect(host.getByTestId('room-screen')).toHaveText(/Screen 1 · showing now/, { timeout: 5_000 });

  // The guest leaves: gone from the panel on its next poll, no reload.
  await guest.getByRole('button', { name: 'Leave room' }).click();
  await expect(guest.getByRole('heading', { name: 'You left the room' })).toBeVisible();
  await expect(host.getByTestId('room-guest')).toHaveCount(0, { timeout: 5_000 });

  // The screen disconnects itself: back to a pairing code, and gone from the panel.
  await screen.getByRole('button', { name: 'Disconnect this screen' }).click();
  await expect(screen.getByRole('heading', { name: 'Pair this screen' })).toBeVisible({ timeout: 5_000 });
  await expect(host.getByTestId('room-screen')).toHaveCount(0, { timeout: 5_000 });

  // Paired again, then the host disconnects just that screen: it shows a new code within a poll.
  const again = (await screen.locator('#d-pairing').textContent()) ?? '';
  await host.getByLabel('Code on the screen').fill(again);
  await host.getByRole('button', { name: 'Pair screen' }).click();
  await expect(screen.locator('#d-qr')).toBeVisible({ timeout: 15_000 });
  await host.getByRole('button', { name: 'Disconnect Screen 1' }).click();
  await expect(host.locator('.room-said')).toHaveText('Screen 1 disconnected.');
  await expect(screen.getByRole('heading', { name: 'Pair this screen' })).toBeVisible({ timeout: 4_000 });
  await expect(screen.locator('#d-pairing')).not.toHaveText(again);

  await Promise.all([phone.close(), tv.close(), hostContext.close()]);
});
