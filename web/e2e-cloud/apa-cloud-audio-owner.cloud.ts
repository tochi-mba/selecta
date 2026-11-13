import { expect, Page, test } from '@playwright/test';
import { listener, signedIn } from './cloud';

// ADR-0419 (one Cloud player, flag `cloud.single_audio_owner`), against the real Cloud site and
// API (playwright.cloud.config.ts). The library lists newest first, so seeded songs appear as
// Song N, ..., Song 1; Listen's session positions count oldest first.

const playing = (page: Page) => page.evaluate(() => [...document.querySelectorAll('audio')].filter((element) => !element.paused).length);
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Cloud workspace' }).getByRole('button', { name }).click();

test('AV-0419-02: Library audio keeps playing while the person moves between pages', async ({ page, request }) => {
  await signedIn(page, request, listener('persist'), { songs: 2, seconds: 30, path: '/library' });
  await page.getByRole('button', { name: 'Listen to Song 2.wav' }).click();
  const audio = page.getByTestId('library-audio');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1);
  await nav(page, 'Overview');
  await nav(page, 'Plan & billing');
  const later = await audio.evaluate((element: HTMLAudioElement) => element.currentTime);
  expect(later).toBeGreaterThan(1);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await expect(page.getByTestId('now-playing')).toHaveText('Song 2.wav');
});

test('AV-0419-03: the speaker and the Library never play at once, and explicit Pause stays paused', async ({ page, request }) => {
  await signedIn(page, request, listener('focus'), { songs: 3, seconds: 30, path: '/listen' });
  await page.getByRole('button', { name: 'Play here' }).click();
  await expect(page.getByTestId('playing-where')).toHaveText('Playing here');
  await expect.poll(() => playing(page)).toBe(1);

  await nav(page, 'Library');
  await page.getByRole('button', { name: 'Listen to Song 3.wav' }).click();
  await expect.poll(() => page.getByTestId('library-audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await expect.poll(() => playing(page)).toBe(1);
  await expect(page.getByText('The speaker on this device is paused while your library plays.')).toBeVisible();

  // Explicit Pause: nothing brings it back, not a page change, not the speaker going quiet.
  await page.getByTestId('library-audio').evaluate((element: HTMLAudioElement) => element.pause());
  await nav(page, 'Overview');
  await page.waitForTimeout(3_000);
  expect(await playing(page)).toBe(0);
});

test('AV-0419-04: Listen reaches songs past the first 200 by asset id', async ({ page, request }) => {
  await signedIn(page, request, listener('catalogue'), { songs: 205, seconds: 2, path: '/listen' });
  const pages: string[] = [];
  page.on('request', (sent) => { if (sent.url().includes('/api/assets?')) pages.push(sent.url()); });
  await page.getByRole('button', { name: 'Play here' }).click();
  await expect(page.getByTestId('playing-where')).toHaveText('Playing here');
  await expect(page.locator('.playing-bar-song')).toContainText('Song 1.wav');
  expect(pages.every((url) => !url.includes('limit=200'))).toBe(true);
  expect(pages.some((url) => url.includes('cursor='))).toBe(true);
});

test('AV-0419-05: the lease moves to another device with no double audio, and a failed song is skipped honestly', async ({ browser, request }) => {
  const user = listener('transfer');
  const one = await (await browser.newContext()).newPage();
  const two = await (await browser.newContext()).newPage();
  await signedIn(one, request, user, { songs: 3, seconds: 30, path: '/listen' });
  await two.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await two.goto('/listen');
  await one.getByRole('button', { name: 'Play here' }).click();
  await expect(one.getByTestId('playing-where')).toHaveText('Playing here');
  await nav(one, 'Library'); // the speaker keeps playing on another page
  await expect.poll(() => playing(one)).toBe(1);

  await two.getByRole('button', { name: 'Play here' }).click();
  await two.getByRole('button', { name: 'Play here instead' }).click();
  await expect(two.getByTestId('playing-where')).toHaveText('Playing here');
  await expect.poll(() => playing(one)).toBe(0);
  await expect.poll(() => playing(two)).toBe(1);

  // The speaker's media fails: one fresh try, then the next song, said plainly.
  await two.route('**/*.wav*', (route) => route.abort());
  // First media failure may recover from a fresh URL; the second must skip and announce.
  const audio = two.getByTestId('speaker-audio');
  await audio.evaluate((element: HTMLAudioElement) => { element.src = '/missing.wav'; });
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => !element.src.endsWith('/missing.wav'))).toBe(true);
  await audio.evaluate((element: HTMLAudioElement) => { element.src = '/missing.wav'; });
  await expect(two.getByRole('alert')).toContainText('could not be played');
});
