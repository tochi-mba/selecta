import { expect, test } from '@playwright/test';
import { listener, signedIn } from '../e2e-cloud/cloud';
import { seedBusiness } from './helpers';

// ADR-0446 BZ-0446-08 (ADR-0453 D10): a staff device that is itself offline queues its presses
// for at most 2 minutes. An older press is dropped with plain words and never sent, so a pause
// can't land minutes later. The device clock is moved on past 2 minutes instead of waiting.

test('test_queued_commands_older_than_two_minutes_are_dropped', async ({ page, context, request }) => {
  const owner = listener('queue-owner');
  const staff = listener('queue-staff');
  await signedIn(page, request, owner);
  await signedIn(page, request, staff);
  const seeded = await seedBusiness(page, owner, { staff });
  await page.goto(`/b/${seeded.org}`);
  await expect(page.getByRole('heading', { name: /^Staff controls/ })).toBeVisible();
  const pause = page.getByTestId('staff-deck').getByRole('button', { name: 'Pause' });
  await expect(pause).toBeVisible();

  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/commands$/.test(new URL(r.url()).pathname)) sent.push(r.url()); });

  await context.setOffline(true);
  await pause.click();
  // three minutes later on this device's clock, still offline
  await page.clock.setFixedTime(new Date(Date.now() + 3 * 60 * 1000));
  await expect(page.getByText("That pause was too late, so we didn't send it")).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
  await page.waitForTimeout(5_000);
  expect(sent).toEqual([]);
});
