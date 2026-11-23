import { expect, Page, Route, test } from '@playwright/test';
import { listener } from './cloud';
import { asLocalFirst, openLocalFirst, seeded } from './localFirst';

// BF-0463-02 progressive import (flag `cloud.progressive_import`, on for these members through
// asLocalFirst). A folder or a pick of files keeps being checked while the member carries on:
// the onboarding spine never blocks on it, the shell chip says how far it has got, a finished
// import still settles the spine's verify step, and an import interrupted by a reload offers to
// carry on without duplicating anything. Registration batches are held at the real e2e server's
// door (page.route) so "while later batches are still held" is a fact, not a race.

/** A short, real WAV whose tone makes every file's bytes (and fingerprint) different. */
function wav(index: number): Buffer {
  const rate = 8_000;
  const frames = 1_600;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + frames * 2, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  const tone = 200 + index * 37;
  for (let frame = 0; frame < frames; frame += 1) bytes.writeInt16LE(Math.round(Math.sin((2 * Math.PI * tone * frame) / rate) * 6000), 44 + frame * 2);
  return bytes;
}

const files = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `Progressive ${String(index + 1).padStart(2, '0')}.wav`, mimeType: 'audio/wav', buffer: wav(index) }));

/** Holds song registrations: the first `free` batches pass after a short delay, the rest wait
 * until `release()`. A request the page abandoned (a reload) is let go quietly. */
async function holdBatches(page: Page, free: number) {
  let seen = 0;
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    seen += 1;
    await new Promise((settled) => setTimeout(settled, 1_500));
    if (seen > free) await gate;
    try { await route.continue(); } catch { /* the page went away while it was held */ }
  };
  await page.route('**/api/local-media/songs', handler);
  return { release: () => open(), batches: () => seen };
}

/** The Library's own song count, from the shell status the import refreshes. */
const songCount = (page: Page, count: number) => page.locator('span').filter({ hasText: new RegExp(`^\\s*${count} songs\\s*$`) });

test('a new member carries on while the import finishes, and verify still settles', async ({ page, request }) => {
  const user = listener('onb-progressive');
  const { workspace_id: workspace } = await seeded(request, user, {});
  const held = await holdBatches(page, 1);
  await openLocalFirst(page, user, '/library');

  await expect(page.getByRole('heading', { level: 2, name: 'Connect your music' })).toBeVisible();
  await page.getByLabel('Choose music files').setInputFiles(files(30));
  await expect(page.getByRole('heading', { level: 2, name: 'Check your music' })).toBeVisible();
  // cloud.resilient_import: real counts in the shared words
  await expect(page.getByText(/Checking your music: \d+( of 30)? checked\./).first()).toBeVisible();

  await page.getByRole('button', { name: 'Continue while it finishes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Check this device' })).toBeVisible();
  // the first batch of five lands while the rest are held at the door
  const chip = page.locator('.cloud-import-chip');
  await expect(chip).toContainText('Checking your music: 5 of 30 checked.');
  await page.getByRole('button', { name: 'Finish later' }).click();
  await expect(songCount(page, 5)).toBeVisible();
  await expect(chip).toContainText('Checking your music:');
  await expect.poll(() => held.batches()).toBe(2);
  await expect(songCount(page, 5)).toBeVisible();

  held.release();
  await expect(songCount(page, 30)).toBeVisible({ timeout: 60_000 });
  await expect(chip).toHaveCount(0);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), `selecta.onboarding.${workspace}`);
  expect(saved.outcomes.verify).toBe('done');
  expect(saved.imported).toMatchObject({ imported: 30, duplicates: 0 });
});

test('an import abandoned by a reload offers to carry on, and picking again duplicates nothing', async ({ page, request }) => {
  const user = listener('onb-abandon');
  await seeded(request, user, {});
  const held = await holdBatches(page, 1);
  await openLocalFirst(page, user, '/library');
  const music = files(12);
  await page.getByLabel('Choose music files').setInputFiles(music);
  await expect(page.locator('.cloud-import-chip')).toContainText('Checking your music: 5 of 12 checked.');
  await expect.poll(() => held.batches()).toBe(2);

  await page.reload();
  held.release();
  // cloud.resilient_import: picked files are gone after a reload by the browser's design, so the
  // offer asks for them again and says everything already done is skipped
  await expect(page.getByRole('note').filter({ hasText: 'Your import stopped part way' })).toContainText('skips everything already done');
  await expect(songCount(page, 5)).toBeVisible();
  await page.locator('.connect-music input[accept="audio/*"]').setInputFiles(music);
  await expect(page.locator('.connect-music').getByText(/songs connected/)).toBeVisible({ timeout: 60_000 });
  // each file once: the five registered before the reload were recognised, not added again
  await expect(songCount(page, 12)).toBeVisible();});

test('an interrupted folder import carries on by itself over the remembered folder', async ({ page, request }) => {
  const user = listener('onb-folder');
  const { workspace_id: workspace } = await seeded(request, user, { local_songs: 1 });
  await asLocalFirst(page, user);
  // a same-origin page that is not the app: make a real folder in the origin-private file
  // system, remember its handle where a folder pick puts it, and leave an interrupted marker
  await page.goto('/api/status');
  const music = files(6).map((file) => ({ name: file.name, bytes: [...file.buffer] }));
  await page.evaluate(async ({ workspace, music }) => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('Crates', { create: true });
    for (const file of music) {
      const handle = await folder.getFileHandle(file.name, { create: true });
      const writing = await handle.createWritable();
      await writing.write(new Uint8Array(file.bytes));
      await writing.close();
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('selecta-media-folders', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('folders');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    await new Promise<void>((resolve, reject) => {
      const writing = db.transaction('folders', 'readwrite');
      writing.objectStore('folders').put(folder, workspace);
      writing.oncomplete = () => resolve();
      writing.onerror = () => reject(writing.error);
    });
    db.close();
    localStorage.setItem(`selecta.import.${workspace}`, JSON.stringify({ version: 1, folder: 'Crates', startedAt: Date.now(), total: 6, registered: 0, kind: 'folder', checked: 0 }));
  }, { workspace, music });

  await page.goto('/library');
  // cloud.resilient_import: the folder's permission is still granted, so it carries on with no press
  await expect(page.getByText('6 songs connected.', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(songCount(page, 7)).toBeVisible();
});
