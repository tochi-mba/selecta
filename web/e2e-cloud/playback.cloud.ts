import { expect, test } from '@playwright/test';
import { listener, r2Log, signedIn } from './cloud';

// SC-0399-03 (signed URL refresh) and SC-0399-04 (the next song is buffered before it's needed).
// The library lists newest first, so seeded songs appear as Song N, ..., Song 1.

test('an expired signed URL mid-song refreshes once, keeping the song, the queue and the place', async ({ page, request }) => {
  const user = listener('refresh');
  await signedIn(page, request, user, { songs: 3, seconds: 20, path: '/library' });
  await page.getByRole('button', { name: 'Listen to Song 3.wav' }).click();
  const audio = page.locator('audio');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1);
  const first = await audio.getAttribute('src');

  await request.post('/test/expire-urls');
  const proxyAsks: string[] = [];
  page.on('request', (sent) => { if (sent.url().includes('/playback-proxy')) proxyAsks.push(sent.method()); });
  // The browser goes back to the network for the file, as it does when its buffer runs out or the
  // connection drops; the expired link now answers 403.
  const place = await audio.evaluate((element: HTMLAudioElement) => { const at = element.currentTime; element.load(); return at; });
  await expect.poll(() => audio.getAttribute('src')).not.toBe(first);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => (element.paused ? -1 : element.currentTime))).toBeGreaterThan(place - 0.5);
  expect(proxyAsks).toEqual(['GET']);
  await expect(page.getByTestId('now-playing')).toHaveText('Song 3.wav');
  await expect(page.getByTestId('up-next')).toContainText('Song 2.wav');
  expect((await r2Log(request)).some((entry) => entry.status === 403)).toBe(true);
});

test('the next song is downloaded before the current one ends, and plays from that copy', async ({ page, request }) => {
  const user = listener('prefetch');
  await signedIn(page, request, user, { songs: 2, seconds: 6, path: '/library' });
  await request.delete('/test/r2/log');
  await page.getByRole('button', { name: 'Listen to Song 2.wav' }).click();
  await expect(page.getByTestId('up-next')).toHaveText('Up next: Song 1.wav · loaded', { timeout: 15_000 });
  const audio = page.locator('audio');
  const left = await audio.evaluate((element: HTMLAudioElement) => element.duration - element.currentTime);
  expect(left).toBeGreaterThan(1); // buffered with time to spare, not at the last moment
  const before = (await r2Log(request)).length;

  await expect(page.getByTestId('now-playing')).toHaveText('Song 1.wav', { timeout: 20_000 });
  expect(await audio.evaluate((element: HTMLAudioElement) => element.src)).toMatch(/^blob:/);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.2);
  // The second song needed no network fetch once it started: it played from the buffered copy.
  expect((await r2Log(request)).slice(before).filter((entry) => entry.method === 'GET')).toEqual([]);
});
