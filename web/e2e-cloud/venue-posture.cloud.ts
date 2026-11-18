import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { listener, signedIn } from './cloud';

// The venue tablet posture (ADR-0460 BF-0460-02/03/07) and the interruption truth (ADR-0457
// BF-0457-03), in a real browser against the real e2e server.
//
// `cloud.venue_tablet` ships off and a per-user rule can never grant what the build denies
// (ADR-0414), so, like local-first-shell.cloud.ts, this spec turns it on for its one person by
// amending only the flag fields of the account answer. Everything else is real: the engine opens a
// real AudioContext from a real click, and the capability probe runs the shipped worklet.
//
// The browser runs muted (--mute-audio). Per ADR-0466 nothing here claims anything about sound:
// every assertion is about the state the page shows. "I heard it" is pressed by the test as the
// person would; that proves the state machine, never that a tone was audible.
//
// The wake lock is a stand-in the test can release, because headless browsers refuse the real one;
// visibility is changed through the document's own visibilitychange event, and a route change
// through navigator.mediaDevices' own devicechange event.

async function openVenue(page: Page, request: APIRequestContext, user: string, options: { noWorklet?: boolean } = {}) {
  await page.route('**/api/account', async (route) => {
    const answer = await route.fetch();
    const account = await answer.json();
    account.features = { ...account.features, devices: true, 'devices.browser_player': true, 'cloud.venue_tablet': true };
    await route.fulfill({ response: answer, json: account });
  });
  await page.addInitScript(({ noWorklet }) => {
    const sentinels: EventTarget[] = [];
    const scope = window as unknown as { venueTest: { release(): void; hide(): void; show(): void } };
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          const sentinel = new EventTarget() as EventTarget & { released: boolean; type: string; release(): Promise<void> };
          sentinel.released = false;
          sentinel.type = 'screen';
          sentinel.release = async () => {
            if (sentinel.released) return;
            sentinel.released = true;
            sentinel.dispatchEvent(new Event('release'));
          };
          sentinels.push(sentinel);
          return sentinel;
        },
      },
    });
    scope.venueTest = {
      release: () => { for (const sentinel of sentinels) void (sentinel as unknown as { release(): Promise<void> }).release(); },
      hide: () => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); },
      show: () => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); },
    };
    if (noWorklet) delete (window as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  }, { noWorklet: options.noWorklet ?? false });
  await signedIn(page, request, user, { path: '/account#venue' });
}

const venue = (page: Page) => page.locator('#venue');
const statusOf = (page: Page) => venue(page).locator('[data-venue-status]');

async function walkToConfirmed(page: Page) {
  const panel = venue(page);
  await expect(panel.getByRole('heading', { name: 'Play a venue from this tablet' })).toBeVisible();
  await panel.getByRole('button', { name: 'Check this tablet' }).click();
  // The real probe ran the shipped worklet in this browser and it passed.
  await panel.getByRole('button', { name: 'It’s plugged in' }).click();
  await panel.getByRole('button', { name: 'Keep the screen on' }).click();
  await expect(panel.getByText(/browser agreed to keep the screen on/)).toBeVisible();
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('radio', { name: /Whatever this device is set to/ }).check();
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('button', { name: /Start sound/ }).click();
  await panel.getByRole('button', { name: /Play the check tone/ }).click();
  await expect(statusOf(page)).toHaveAttribute('data-venue-status', 'output_unverified');
  await panel.getByRole('button', { name: /I heard it/ }).click();
  await expect(statusOf(page)).toHaveAttribute('data-venue-status', 'verified');
}

test('the venue flow walks to a person-confirmed status, and stores a capability record', async ({ page, request }) => {
  const user = listener('venue-flow');
  await openVenue(page, request, user);
  await walkToConfirmed(page);
  const record = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('selecta.venue.record.'));
    return key ? localStorage.getItem(key) : null;
  });
  const parsed = JSON.parse(record ?? '{}');
  expect(parsed.schema).toBe('selectadj/capability-record/1');
  expect(parsed.probes.worklet.ok).toBe(true);
  expect(parsed.probes.worklet.blocks).toBeGreaterThan(0);
  expect(Object.keys(parsed.tuple)).toEqual(['device_model', 'os_version', 'browser_engine', 'browser_version', 'engine_version', 'codec', 'media_source', 'output_type']);
});

test('interruptions downgrade the state: hidden tab, wake lock release, route change', async ({ page, request }) => {
  await openVenue(page, request, listener('venue-interrupt'));
  await walkToConfirmed(page);

  await page.evaluate(() => (window as unknown as { venueTest: { hide(): void } }).venueTest.hide());
  await expect(statusOf(page)).toHaveAttribute('data-venue-status', 'uncertain');
  await expect(venue(page).getByText(/Bring SelectaDJ back to the front/)).toBeVisible();
  await page.evaluate(() => (window as unknown as { venueTest: { show(): void } }).venueTest.show());
  // Back in front is not proof of sound: still unconfirmed, with a re-check offered.
  await expect(statusOf(page)).toHaveAttribute('data-venue-status', 'output_unverified');
  await expect(venue(page).getByText(/Something interrupted this tablet/)).toBeVisible();

  await venue(page).getByRole('button', { name: /Play the check tone again/ }).click();
  await venue(page).getByRole('button', { name: /Play the check tone/ }).click();
  await venue(page).getByRole('button', { name: /I heard it/ }).click();
  await expect(statusOf(page)).toHaveAttribute('data-venue-status', 'verified');

  await page.evaluate(() => (window as unknown as { venueTest: { release(): void } }).venueTest.release());
  await expect(statusOf(page)).toHaveAttribute('data-venue-status', 'uncertain');
  await expect(venue(page).getByText(/Press Keep the screen on again/)).toBeVisible();

  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  await expect(venue(page).getByText(/The audio output changed. Play the check tone/)).toBeVisible();
});

test('a deep link on a device that cannot run the player explains and offers the fallbacks', async ({ page, request }) => {
  await openVenue(page, request, listener('venue-fallback'), { noWorklet: true });
  const panel = venue(page);
  await expect(panel.getByText(/The link you followed opens the venue player set-up/)).toBeVisible();
  await expect(panel.locator('[data-venue-reason]')).toContainText('no AudioWorklet');
  await expect(panel.getByRole('link', { name: 'Control a player on another device' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Check this tablet' })).toHaveCount(0);
});

test('with cloud.venue_tablet off, the settings page closes up around the venue flow', async ({ page, request }) => {
  await signedIn(page, request, listener('venue-off'), { path: '/account#venue' });
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
  await expect(page.locator('#venue')).toHaveCount(0);
  await expect(page.getByText('Play a venue from this tablet')).toHaveCount(0);
});
