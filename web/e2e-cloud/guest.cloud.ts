import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { endRooms, hostWithRoom, slowPhone } from './helpers';

// SC-0416-02: the guest page on a 320 px phone over a slow network: join, search, request,
// vote, the honest status states, paused music, leaving and the room ending. It loads under
// 100 KB of JavaScript and never shows who the host is.

test.beforeEach(async ({ page }) => { await endRooms(page); });

test('a guest joins, requests, votes and follows their requests on a slow phone', async ({ browser }) => {
  const { context: hostContext, host, joinPath } = await hostWithRoom(browser);
  const { context, page } = await slowPhone(browser);
  let scriptBytes = 0;
  page.on('response', async (response) => {
    if (response.request().resourceType() === 'script') scriptBytes += (await response.body()).length;
  });

  await page.goto(joinPath);
  await expect(page.getByRole('heading', { name: 'Request a song' })).toBeVisible();
  expect(scriptBytes).toBeGreaterThan(0);
  expect(scriptBytes).toBeLessThan(100 * 1024);
  await expect(page.getByText('deletes them 30 days after the room closes')).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

  await page.getByRole('button', { name: 'Join the room' }).click();
  await expect(page.getByRole('heading', { name: 'Garden party' })).toBeVisible({ timeout: 30_000 });
  // No speaker device is playing yet, and the page says so.
  await expect(page.getByText("The music's paused")).toBeVisible();
  // The host's identity never reaches a guest.
  await expect(page.locator('body')).not.toContainText('alice@example.test');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.getByLabel("Search the host's songs").fill('Song 12');
  await page.getByRole('button', { name: 'Request Song 12 - Artist 5' }).click();
  await expect(page.getByRole('status')).toContainText('Sent: Song 12.', { timeout: 30_000 });
  const mine = page.getByRole('region', { name: 'My requests' });
  await expect(mine).toContainText('Song 12');
  await expect(mine).toContainText('Accepted');

  // A second guest asks for the same song: it becomes a vote. Then they vote, and unvote.
  const second = await slowPhone(browser);
  await second.page.goto(joinPath);
  await second.page.getByRole('button', { name: 'Join the room' }).click();
  await expect(second.page.getByRole('heading', { name: 'Garden party' })).toBeVisible({ timeout: 30_000 });
  const vote = second.page.getByRole('button', { name: 'Vote for Song 12 - Artist 5' });
  await expect(vote).toHaveAttribute('aria-pressed', 'false');
  await vote.click();
  await expect(second.page.getByRole('button', { name: 'Remove your vote for Song 12 - Artist 5' })).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await second.page.getByLabel("Search the host's songs").fill('Song 12');
  await second.page.getByRole('button', { name: 'Request Song 12 - Artist 5' }).click();
  await expect(second.page.getByRole('status')).toContainText(/already|vote/, { timeout: 30_000 });

  // The host asks to approve each request and passes on one: the guest is told honestly.
  await host.getByLabel('Requests', { exact: true }).selectOption('approve');
  await expect(host.locator('.room-said')).toHaveText('Saved.');
  await second.page.getByLabel("Search the host's songs").fill('Song 20');
  await second.page.getByRole('button', { name: 'Request Song 20 - Artist 6' }).click();
  await expect(second.page.getByRole('region', { name: 'My requests' })).toContainText('Sent', { timeout: 30_000 });
  await host.getByRole('button', { name: 'Pass on Song 20 - Artist 6' }).click();
  await expect(second.page.getByRole('region', { name: 'My requests' })).toContainText('The host passed on this one', { timeout: 30_000 });

  // Leaving clears the guest's cookie; the page offers to join again.
  await second.page.getByRole('button', { name: 'Leave room' }).click();
  await expect(second.page.getByRole('heading', { name: 'You left the room' })).toBeVisible({ timeout: 30_000 });

  // The host ends the room and the first guest's page says so by itself.
  await host.getByRole('button', { name: 'End room' }).click();
  await host.getByRole('button', { name: 'End room' }).click();
  await expect(page.getByRole('heading', { name: 'This room has ended' })).toBeVisible({ timeout: 40_000 });

  await Promise.all([context.close(), second.context.close(), hostContext.close()]);
});

test('a locked room and a wrong code are refused in plain words', async ({ browser }) => {
  const { context: hostContext, host, joinPath } = await hostWithRoom(browser);
  await host.getByRole('button', { name: 'Lock room' }).click();
  await expect(host.getByTestId('room-status')).toHaveText('Locked: no new guests');
  const { context, page } = await slowPhone(browser);
  await page.goto(joinPath);
  await page.getByRole('button', { name: 'Join the room' }).click();
  await expect(page.getByRole('alert')).toHaveText("This room isn't taking new guests.", { timeout: 30_000 });
  await page.goto('/r/ZZZZZZZZ');
  await page.getByRole('button', { name: 'Join the room' }).click();
  await expect(page.getByRole('alert')).toHaveText("There's no room with that code.", { timeout: 30_000 });
  await Promise.all([context.close(), hostContext.close()]);
});
