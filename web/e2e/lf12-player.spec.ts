import { expect, test, type Page } from '@playwright/test';

// Runs against a Vite dev server; see docs/integration/lf12.md. The fixture uses synthetic
// metadata only, so no licensed music, cloud auth, server runtime or local media is required.
const URL = (process.env.SELECTA_LF12_VITE_URL ?? 'http://127.0.0.1:5182') +
  '/src/cloud/lf-device-control/lf12-fixture.html';

async function open(page: Page) {
  await page.goto(URL);
  await expect(page.getByTestId('lf12-actual-speaker')).toContainText('Old speaker');
  await expect(page.getByTestId('lf12-player')).toBeVisible();
}
async function refresh(page: Page) {
  await page.getByRole('button', { name: 'Refresh device status' }).click();
}

test('two independent browser contexts control one device without duplicating browser audio', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    await Promise.all([open(a), open(b)]);
    await expect(a.getByTestId('lf12-actual-speaker')).toContainText('Playing on Old speaker');
    await expect(b.getByTestId('lf12-actual-speaker')).toContainText('Playing on Old speaker');
    await b.getByRole('button', { name: 'Control Existing Speaker' }).click();
    await b.getByRole('button', { name: 'Pause speaker' }).click();
    await expect(b.getByTestId('lf12-command')).toContainText('queued');
    expect(await b.evaluate(() => window.lf12?.commands.length)).toBe(1);
    expect(await a.evaluate(() => window.lf12?.commands.length)).toBe(0);
    await Promise.all([a, b].map((page) => page.evaluate(() => {
      if (!window.lf12) return;
      window.lf12.session = { ...window.lf12.session, state: 'paused', observed_at: new Date().toISOString() };
    })));
    await Promise.all([refresh(a), refresh(b)]);
    await expect(a.getByTestId('lf12-actual-speaker')).toContainText('Paused on Old speaker');
    await expect(b.getByTestId('lf12-actual-speaker')).toContainText('Paused on Old speaker');
    expect(await a.locator('audio').count()).toBe(0);
    expect(await b.locator('audio').count()).toBe(0);
  } finally {
    await contextA.close(); await contextB.close();
  }
});

test('missing music and disconnected source block takeover before any command', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    if (!window.lf12) return;
    window.lf12.availabilityState = [
      { occurrence_id: 'a', state: 'ready', reason: null },
      { occurrence_id: 'b', state: 'source_disconnected', reason: 'USB drive offline' },
    ];
  });
  await page.getByRole('button', { name: 'Verify local recordings' }).click();
  await expect(page.getByText('1/2 verified local recordings')).toBeVisible();
  await expect(page.getByTestId('lf12-play-here')).toBeDisabled();
  expect(await page.evaluate(() => window.lf12?.preflights)).toBe(0);
  expect(await page.evaluate(() => window.lf12?.commands.length)).toBe(0);
});

test('partitioned original speaker blocks an unsafe takeover', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { if (window.lf12) window.lf12.session.original_can_be_fenced = false; });
  await refresh(page);
  await expect(page.getByRole('alert')).toContainText('Unsafe takeover blocked');
  await expect(page.getByTestId('lf12-play-here')).toBeDisabled();
  expect(await page.evaluate(() => window.lf12?.commands.length)).toBe(0);
});

test('destination offline or controller-only phone cannot Play Here', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { if (window.lf12) window.lf12.devices[0].connectivity = 'offline'; });
  await refresh(page);
  await expect(page.getByTestId('lf12-play-here')).toBeDisabled();
  await page.evaluate(() => {
    if (!window.lf12) return;
    window.lf12.devices[0] = {
      ...window.lf12.devices[0], connectivity: 'online',
      last_confirmed_server_at: new Date().toISOString(),
      name: 'Controller phone', role: 'controller_only', outputs: [],
    };
  });
  await refresh(page);
  await expect(page.getByTestId('lf12-controller-only')).toContainText('cannot play recordings');
  await expect(page.getByTestId('lf12-play-here')).toBeDisabled();
});

test('slow ACK never announces audio until actual engine telemetry confirms sound', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { if (window.lf12) window.lf12.slowAckMs = 950; });
  await expect(page.getByTestId('lf12-play-here')).toBeEnabled();
  await page.getByTestId('lf12-play-here').click();
  await expect(page.getByRole('alertdialog')).toContainText('original must confirm release');
  await page.getByRole('button', { name: 'Confirm Play Here' }).click();
  await expect(page.getByTestId('lf12-command')).toContainText('queued');
  await expect(page.getByTestId('lf12-actual-speaker')).toContainText('Old speaker');
  await page.evaluate(() => {
    if (!window.lf12) return;
    window.lf12.ack = 'applied';
    window.lf12.session = {
      ...window.lf12.session, speaker_device_id: 'pc', speaker_name: 'Studio PC',
      output_id: 'dac', output_name: 'USB DAC', generation: 24,
      observed_at: new Date().toISOString(), output_state: 'audible',
    };
  });
  await expect(page.getByTestId('lf12-command')).toContainText('applied', { timeout: 8000 });
  await expect(page.getByTestId('lf12-actual-speaker')).toContainText('Playing on Studio PC');
});


test('output switching stays queued until the engine confirms the new physical output', async ({ page }) => {
  await open(page);
  await page.getByLabel('Change Output').selectOption('alternate');
  await page.getByRole('button', { name: 'Apply output change' }).click();
  await expect(page.getByTestId('lf12-command')).toContainText('queued');
  expect(await page.evaluate(() => window.lf12?.commands[0]?.command)).toBe('change_output');
  await expect(page.getByTestId('lf12-actual-speaker')).toContainText('Main speakers');
  await page.evaluate(() => {
    if (!window.lf12) return;
    window.lf12.ack = 'applied';
    window.lf12.session = {
      ...window.lf12.session, output_id: 'alternate', output_name: 'Alternate output',
      generation: 24, output_state: 'audible', observed_at: new Date().toISOString(),
    };
  });
  await expect(page.getByTestId('lf12-command')).toContainText('applied', { timeout: 8000 });
  await expect(page.getByTestId('lf12-actual-speaker')).toContainText('Alternate output');
});

test('failed output preflight preserves the current speaker and verified output', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { if (window.lf12) window.lf12.preflightSafe = false; });
  await page.getByLabel('Change Output').selectOption('alternate');
  await page.getByRole('button', { name: 'Apply output change' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Destination preparation failed' })).toBeVisible();
  expect(await page.evaluate(() => window.lf12?.commands.length)).toBe(0);
  await expect(page.getByTestId('lf12-actual-speaker')).toContainText('Main speakers');
});

test('screen reader output stays truthful after stale telemetry or reconnection', async ({ page }) => {
  await open(page);
  const where = page.getByTestId('lf12-actual-speaker');
  await expect(where).toHaveAttribute('aria-live', 'polite');
  await page.evaluate(() => {
    if (window.lf12) window.lf12.session.observed_at = new Date(Date.now() - 60_000).toISOString();
  });
  await refresh(page);
  await expect(where).toContainText('current sound unverified');
  await page.evaluate(() => {
    if (window.lf12) window.lf12.session.observed_at = new Date().toISOString();
  });
  await refresh(page);
  await expect(where).toContainText('Playing on Old speaker');
});

test('forbidden R2 proxy, FLAC and PCM requests are never made by this player', async ({ page }) => {
  const violations: string[] = [];
  await page.route(/playback-proxy|\\.flac(?:\\?|$)|\\.pcm(?:\\?|$)|r2\\.cloudflarestorage/i, (route) => {
    violations.push(route.request().url());
    return route.abort();
  });
  await open(page);
  await page.getByRole('button', { name: 'Control Existing Speaker' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('lf12-command')).toContainText('queued');
  expect(violations).toEqual([]);
  expect(await page.locator('audio').count()).toBe(0);
});
