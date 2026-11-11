import { APIRequestContext, Browser, BrowserContext, expect, Page } from '@playwright/test';

/** A phone on a weak connection: 320 px wide, touch, and a slow 3G-like network. */
export async function slowPhone(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 320, height: 640 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 8.0; Nexus 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // About 400 kbit/s down, 300 ms round trips.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 50_000, uploadThroughput: 25_000 });
  return { context, page };
}

/** Open the host's harness page for a test person and open a room if none is open. */
export async function hostWithRoom(browser: Browser, as = 'alice', name = 'Garden party'): Promise<{ context: BrowserContext; host: Page; code: string; joinPath: string }> {
  const context = await browser.newContext();
  const host = await context.newPage();
  await host.goto(`/harness?as=${as}`);
  const current = host.getByTestId('room-code');
  if (!(await current.isVisible().catch(() => false))) {
    await host.getByLabel('Room name guests will see').fill(name);
    await host.getByRole('button', { name: 'Open room' }).click();
  }
  await expect(host.getByTestId('room-code')).toHaveText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  const code = (await host.getByTestId('room-code').textContent()) ?? '';
  return { context, host, code, joinPath: `/r/${code.replace('-', '')}` };
}

/** End whatever room this person has open, through the API, so tests start clean. */
export async function endRooms(page: Page, as = 'alice'): Promise<void> {
  const headers = { Authorization: `Bearer ${as}` };
  const current = await (await page.request.get('/api/rooms/current', { headers })).json();
  if (current.room) await page.request.post(`/api/rooms/${current.room.room.id}/end`, { headers });
}

/** Every <audio> on a page that is playing right now. */
export async function playingAudio(page: Page): Promise<number> {
  return page.evaluate(() => [...document.querySelectorAll('audio')].filter((a) => !a.paused && !a.ended).length);
}

/** Start a devices test clean: sign out every device this person has and forget their playback
 * session. An earlier test or failed attempt otherwise leaves devices signed in under the same
 * names, a speaker holding a live lease (so Play here asks first) and the music several songs
 * along (so a later run can reach the end of the six test songs). */
export async function startDevicesClean(request: APIRequestContext, as: string): Promise<void> {
  const headers = { Authorization: `Bearer ${as}` };
  const listed = await request.get('/api/devices', { headers });
  expect(listed.ok()).toBe(true);
  for (const device of (await listed.json()).devices as { id: string }[]) {
    expect((await request.post(`/api/devices/${device.id}/sign-out`, { headers })).ok()).toBe(true);
  }
  expect((await request.post('/test/reset-playback', { data: { user: as } })).ok()).toBe(true);
}
