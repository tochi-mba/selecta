import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { accessible, listener, r2Log, signedIn } from './cloud';

// SC-0402-03 (over quota), SC-0398-05 (upload resume) and SC-0412-04 (data export).

const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Cloud workspace' });

test('over quota: the banner names the overage, uploads wait, listening and downloads still work', async ({ page, request }) => {
  const user = listener('over');
  await signedIn(page, request, user, { songs: 2, seconds: 3 });
  await request.post('/test/quota', { data: { user, limit_bytes: 100_000 } });
  const banner = page.getByRole('alert').filter({ hasText: 'over Free’s' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/You’re \d+\.\d MB over Free’s 0\.1 MB/);
  await expect(banner).toContainText('Nothing has been deleted.');
  await accessible(page, 'over-quota overview');

  await nav(page).getByRole('button', { name: 'Add music' }).click();
  await expect(page.getByText(/new uploads and exports are paused/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start upload' })).toBeDisabled();
  await expect(page.locator('input[type=file]')).toBeDisabled();

  await banner.getByRole('button', { name: 'Manage storage' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your library');
  await page.getByRole('button', { name: 'Listen to Song 1.wav' }).click();
  await expect(page.getByTestId('now-playing')).toHaveText('Song 1.wav');
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0.2);

  await nav(page).getByRole('button', { name: 'Settings' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  expect((await download).suggestedFilename()).toBe('selectadj-account-export.zip');

  await nav(page).getByRole('button', { name: 'Plan & billing' }).click();
  await expect(page.getByRole('region', { name: 'Exports this month' })).toContainText('Paused while you are over your storage limit');
  await banner.getByRole('button', { name: 'Upgrade' }).click();
  await expect(page.getByRole('button', { name: 'Choose Premium' })).toBeVisible();
});

test('Download my data saves a ZIP with originals, settings.json and mixes.json', async ({ page, request }) => {
  const user = listener('export');
  await signedIn(page, request, user, { songs: 1, seconds: 1, path: '/account' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('selectadj-account-export.zip');
  // A ZIP's central directory names every entry in plain bytes.
  const names = readFileSync(await saved.path()).toString('latin1');
  for (const entry of ['settings.json', 'mixes.json', 'manifest.json', 'assets.json', 'originals/']) expect(names).toContain(entry);
  await expect(page.getByText(/original files, settings\.json and mixes\.json/)).toBeVisible();
});

test('a refreshed browser carries on an upload from the parts already uploaded', async ({ page, request }) => {
  const user = listener('resume');
  await signedIn(page, request, user, { path: '/upload' });
  // 60 seconds of WAV is about 10.6 MB: two 8 MiB parts.
  const audio = Buffer.from(await (await request.get('/test/wav?seconds=60')).body());
  const file = { name: 'Long Take.wav', mimeType: 'audio/wav', buffer: audio };
  await request.delete('/test/r2/log');
  await request.post('/test/r2/fail-parts', { data: { parts: [2] } });

  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: 'Start upload' }).click();
  await expect(page.getByText('Needs attention', { exact: true })).toBeVisible({ timeout: 60_000 });
  const before = await r2Log(request);
  expect(before.filter((entry) => entry.method === 'PUT' && entry.status === 200).map((entry) => entry.part)).toEqual([1]);

  await request.post('/test/r2/fail-parts', { data: { parts: [] } });
  await page.reload();
  const unfinished = page.getByRole('region', { name: 'Unfinished uploads' });
  await expect(unfinished).toContainText('Long Take.wav');
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: 'Start upload' }).click();
  await expect(page.getByText('Upload accepted')).toBeVisible({ timeout: 60_000 });
  const sent = (await r2Log(request)).filter((entry) => entry.method === 'PUT' && entry.status === 200).map((entry) => entry.part);
  // Part 1 went once, before the refresh; only part 2 was sent after it.
  expect(sent).toEqual([1, 2]);
  await expect(unfinished).toHaveCount(0);
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('Long Take.wav')).toBeVisible();
});
