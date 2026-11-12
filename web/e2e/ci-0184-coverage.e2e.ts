import { expect, test, type Page } from '@playwright/test';
import { resetMix, stickingOut } from './helpers';

/**
 * CI-0184-03: one browser matrix that deliberately crosses the Creative Interface programme.
 *
 * The focused feature specs remain the source of detailed assertions. This suite supplies the
 * missing cross-cutting proof that their states still compose in a real browser at both ends of
 * the supported layout range, and that a failed read never becomes an empty or successful state.
 */
const SURFACES = [
  { address: '/mixes', heading: 'Make a Mix', tasks: 'CI-0165 CI-0168 CI-0169' },
  { address: '/listen', heading: /Morning Light|Nothing to play yet/, tasks: 'CI-0170 CI-0171 CI-0172' },
  { address: '/mix/current/edit', heading: /Your mix|Nothing here yet/, tasks: 'CI-0167 CI-0173 CI-0174' },
  { address: '/library', heading: 'Library', tasks: 'CI-0166 CI-0177' },
  { address: '/discover', heading: 'Word connections', tasks: 'CI-0175 CI-0176' },
  { address: '/discover/harmonic', heading: 'Harmonic matches', tasks: 'CI-0176' },
  { address: '/workshop', heading: 'Workspace', tasks: 'CI-0178 CI-0180' },
] as const;

test.beforeEach(async ({ request }) => {
  await resetMix(request);
});

test('CI browser matrix keeps every creative surface reachable without overflow or a missing identity', async ({ page }) => {
  const failures: string[] = [];
  for (const [width, height] of [[320, 568], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    for (const surface of SURFACES) {
      await page.goto(surface.address);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: surface.heading })).toBeVisible();
      failures.push(...await stickingOut(page, `${surface.tasks} ${surface.address} at ${width}px`));
    }
  }
  expect(failures).toEqual([]);
});

type FailureCase = {
  address: string;
  api: string;
  message: RegExp;
  retry: RegExp;
  tasks: string;
};

const FAILED_READS: FailureCase[] = [
  {
    address: '/mixes',
    api: '**/api/vibes*',
    message: /Couldn’t load mix suggestions/,
    retry: /Try again/,
    tasks: 'CI-0168 CI-0181 CI-0182',
  },
  {
    address: '/library',
    api: '**/api/library*',
    message: /Couldn’t load your library/,
    retry: /Try again/,
    tasks: 'CI-0177 CI-0182',
  },
  {
    address: '/discover',
    api: '**/api/links*',
    message: /Couldn’t search your lyrics/,
    retry: /Try again/,
    tasks: 'CI-0175 CI-0176 CI-0182',
  },
  {
    address: '/discover/harmonic',
    api: '**/api/discoveries/harmonic*',
    message: /Couldn’t load harmonic discoveries/,
    retry: /Try again/,
    tasks: 'CI-0176 CI-0182',
  },
];

async function failedRead(page: Page, item: FailureCase) {
  let attempts = 0;
  await page.route(item.api, async (route) => {
    attempts += 1;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' });
  });
  await page.goto(item.address);
  await expect(page.getByText(item.message)).toBeVisible();
  const retry = page.getByRole('button', { name: item.retry }).first();
  await expect(retry).toBeVisible();
  const before = attempts;
  await retry.click();
  await expect.poll(() => attempts, { message: `${item.tasks} retry must repeat the failed read` })
    .toBeGreaterThan(before);
}

test('failed creative reads never look empty or successful and every recovery really retries', async ({ page }) => {
  for (const item of FAILED_READS) {
    await failedRead(page, item);
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('missing creative routes never strand the listener or invent a page', async ({ page }) => {
  await page.goto('/this-creative-route-does-not-exist');
  await expect(page.getByRole('heading', { name: 'There’s nothing at this address.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Make a Mix', exact: true })).toBeVisible();
  await expect(page.getByText(/ready|saved|played/i)).toHaveCount(0);
});
