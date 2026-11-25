import { expect, Page, Route, test } from '@playwright/test';
import { listener } from './cloud';
import { asLocalFirst, connectOnThisDevice, openLocalFirst, seeded } from './localFirst';

// Plan "Nothing is lost when something interrupts SelectaDJ": one spec per row of its UX table.
// Every interruption has one owner surface and one next step, and finished work is never thrown
// away. Flags `cloud.resilient_import`, `cloud.offline_shell`, `cloud.offline_playback` and
// `cloud.mix_outbox` ship on. The connection is cut with `context.setOffline`, which fails every
// request the page makes and fires the browser's offline and online events.
//
// Not here: "Storage full" (storage-pressure.cloud.ts keeps the pause copy) and "Local scan
// interrupted" (Local mode, the Python suite).

/** A short, real WAV whose tone makes every file's bytes (and fingerprint) different. */
function wav(index: number): Buffer {
  const rate = 8_000;
  const frames = 1_600;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + frames * 2, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  const tone = 300 + index * 41;
  for (let frame = 0; frame < frames; frame += 1) bytes.writeInt16LE(Math.round(Math.sin((2 * Math.PI * tone * frame) / rate) * 6000), 44 + frame * 2);
  return bytes;
}

const files = (count: number, prefix = 'Kept') => Array.from({ length: count }, (_, index) => ({ name: `${prefix} ${String(index + 1).padStart(2, '0')}.wav`, mimeType: 'audio/wav', buffer: wav(index) }));

/** Holds song registrations: the first `free` pass after a short delay, the rest wait until
 * `release()`. A request the page abandoned (a reload, the connection cut) is let go quietly. */
async function holdBatches(page: Page, free: number) {
  let seen = 0;
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => { open = resolve; });
  await page.route('**/api/local-media/songs', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    seen += 1;
    await new Promise((settled) => setTimeout(settled, 800));
    if (seen > free) await gate;
    try { await route.continue(); } catch { /* the page went away while it was held */ }
  });
  return { release: () => open(), batches: () => seen };
}

/** The Library's own song count, from the shell status the import refreshes. */
const songCount = (page: Page, count: number) => page.locator('span').filter({ hasText: new RegExp(`^\\s*${count} songs\\s*$`) });
const chip = (page: Page) => page.locator('.cloud-import-chip');
/** A new member's getting-started spine stands in for the page they opened until it is put off
 * (77a9a91d); Finish later shows the Library, whose own count proves the import landed. */
const finishLater = (page: Page) => page.getByRole('button', { name: 'Finish later' }).click();

/** Resolves once the account's holdings say a device holds songs: a first visit reports this
 * device's songs only after it registers, and Play before that finds no device to play on
 * (to-do T-20261125-de03). Start it before the page opens. */
const heldOnADevice = (page: Page) => page.waitForResponse(async (answer) => {
  if (!/\/api\/local-media\/holdings$/.test(new URL(answer.url()).pathname) || !answer.ok()) return false;
  const body = await answer.json().catch(() => null) as { devices?: { songs: number; online: boolean }[] } | null;
  return !!body?.devices?.some((device) => device.online && device.songs > 0);
}, { timeout: 30_000 });

/** Put a real folder in the origin-private file system and remember it where a folder pick does,
 * so a reload can carry the import on over it without a picker. */
async function rememberedFolder(page: Page, workspace: string, count: number) {
  await page.goto('/api/status');
  const music = files(count, 'Folder').map((file) => ({ name: file.name, bytes: [...file.buffer] }));
  await page.evaluate(async ({ workspace, music }) => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('Chill Hits', { create: true });
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
  }, { workspace, music });
}

/** Rows of the workspace's import journal, by state. */
const journal = (page: Page, workspace: string) => page.evaluate(async (name) => {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('files', { keyPath: 'key' });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => resolve(null);
  });
  if (!db) return {};
  const rows = await new Promise<{ state: string }[]>((resolve) => {
    const reading = db.transaction('files', 'readonly').objectStore('files').getAll();
    reading.onsuccess = () => resolve(reading.result as { state: string }[]);
    reading.onerror = () => resolve([]);
  });
  db.close();
  return rows.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.state]: (counts[row.state] ?? 0) + 1 }), {});
}, `selecta-media-journal-ws-${encodeURIComponent(workspace)}`);

test.describe('nothing is lost when something interrupts SelectaDJ', () => {
  test('internet drops during import: reading carries on, the chip says offline with counts, it sends on reconnect', async ({ page, context, request }) => {
    const user = listener('nl-offline-import');
    const { workspace_id: workspace } = await seeded(request, user, {});
    const held = await holdBatches(page, 1);
    await openLocalFirst(page, user, '/library');
    await page.getByLabel('Choose music files').setInputFiles(files(20));
    await page.getByRole('button', { name: 'Continue while it finishes' }).click();
    await expect(chip(page)).toContainText(/of 20 checked/);
    await expect.poll(() => held.batches()).toBe(2);

    await context.setOffline(true);
    held.release();
    await expect(chip(page)).toContainText(/Offline\. \d+ of 20 checked\. Carries on when you’re back online\./, { timeout: 30_000 });
    await expect(page.getByRole('status').filter({ hasText: 'You’re offline.' }).first()).toBeVisible();
    // reading went on locally: every file is fingerprinted and kept on this device
    await expect.poll(async () => {
      const rows = await journal(page, workspace);
      return (rows.fingerprinted ?? 0) + (rows.registered ?? 0) + (rows.saved ?? 0);
    }, { timeout: 30_000 }).toBe(20);

    await context.setOffline(false);
    await finishLater(page);
    await expect(songCount(page, 20)).toBeVisible({ timeout: 60_000 });
    await expect(chip(page)).toHaveCount(0);
  });

  test('the service not answering: the chip counts down to the next try, and Try now sends at once', async ({ page, request }) => {
    const user = listener('nl-server-error');
    await seeded(request, user, {});
    let failing = true;
    await page.route('**/api/local-media/songs', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      if (failing) return route.fulfill({ status: 503, json: { detail: 'down for a moment' } });
      return route.continue();
    });
    await openLocalFirst(page, user, '/library');
    await page.getByLabel('Choose music files').setInputFiles(files(6, 'Busy'));
    await page.getByRole('button', { name: 'Continue while it finishes' }).click();
    await expect(chip(page)).toContainText(/SelectaDJ’s service isn’t answering\. Trying again in \d+ s\./, { timeout: 30_000 });
    // never a raw error
    await expect(page.getByText(/Failed to fetch|Request failed \(503\)/)).toHaveCount(0);
    failing = false;
    await chip(page).getByRole('button', { name: 'Try now' }).click();
    await finishLater(page);
    await expect(songCount(page, 6)).toBeVisible({ timeout: 60_000 });
  });

  test('tab closed or reloaded mid-import: the next open carries on by itself and no file is read twice', async ({ page, request }) => {
    const user = listener('nl-reload');
    const { workspace_id: workspace } = await seeded(request, user, {});
    await asLocalFirst(page, user);
    await rememberedFolder(page, workspace, 12);
    const held = await holdBatches(page, 1);
    // the folder is remembered, so the shell's carry-on check starts the import as an interrupted one would
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: 1, folder: 'Chill Hits', startedAt: Date.now(), total: 12, registered: 0, kind: 'folder', checked: 0, importId: 'e2e-import' })), `selecta.import.${workspace}`);
    await page.goto('/library');
    await expect(chip(page)).toContainText(/of 12 checked/, { timeout: 30_000 });
    await expect.poll(() => held.batches()).toBe(2);
    await expect.poll(async () => (await journal(page, workspace)).fingerprinted ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.reload();
    held.release();
    // the chip names an import that resumed, with its real count
    await expect(chip(page)).toContainText('Carrying on your import', { timeout: 30_000 });
    await expect(chip(page)).toContainText(/\d+ of 12 checked/);
    await expect(songCount(page, 12)).toBeVisible({ timeout: 60_000 });
    // the journal is cleared once the import really finished
    await expect.poll(async () => Object.keys(await journal(page, workspace)).length, { timeout: 30_000 }).toBe(0);
  });

  test('picked files after a reload: asks to choose them again, then skips everything already done', async ({ page, request }) => {
    const user = listener('nl-repick');
    await seeded(request, user, {});
    const held = await holdBatches(page, 1);
    await openLocalFirst(page, user, '/library');
    const music = files(10, 'Repick');
    await page.getByLabel('Choose music files').setInputFiles(music);
    await expect.poll(() => held.batches()).toBe(2);
    await page.reload();
    held.release();
    // the offer's words since 4ad97ad4: what stopped, with its count, and the one step
    const offer = page.getByRole('note').filter({ hasText: 'stopped part way' });
    await expect(offer).toContainText(/\d+ of 10 checked/);
    await expect(offer).toContainText('Choose the same songs again');
    await expect(offer).toContainText('SelectaDJ carries on from there');
    await page.locator('.connect-music input[accept="audio/*"]').setInputFiles(music);
    await expect(songCount(page, 10)).toBeVisible({ timeout: 60_000 });
  });

  test('sign-in expired: the page says sign in again and that the import is kept', async ({ page, request }) => {
    const user = listener('nl-signin');
    const { workspace_id: workspace } = await seeded(request, user, {});
    await asLocalFirst(page, user);
    await page.goto('/api/status');
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ version: 1, folder: 'Chill Hits', startedAt: Date.now(), total: 40, registered: 12, kind: 'folder', checked: 15, importId: 'e2e-kept', kept: true })), `selecta.import.${workspace}`);
    await page.route('**/api/account', (route) => route.fulfill({ status: 401, json: { detail: { code: 'session_revoked', message: 'You were signed out. Sign in again.' } } }));
    await page.goto('/library');
    await expect(page.getByText('Your music import is kept on this device and carries on after you sign in.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
    // nothing on this device was cleared
    expect(await page.evaluate((key) => localStorage.getItem(key), `selecta.import.${workspace}`)).not.toBeNull();
  });

  test('a second tab follows the import and never starts or deletes one', async ({ page, context, request }) => {
    const user = listener('nl-two-tabs');
    const { workspace_id: workspace } = await seeded(request, user, {});
    const held = await holdBatches(page, 1);
    await openLocalFirst(page, user, '/library');
    await page.getByLabel('Choose music files').setInputFiles(files(15, 'Tabs'));
    await page.getByRole('button', { name: 'Continue while it finishes' }).click();
    await expect(chip(page)).toContainText(/of 15 checked/);

    const second = await context.newPage();
    await asLocalFirst(second, user);
    await second.route('**/api/local-media/songs', (route) => (route.request().method() === 'POST' ? route.abort() : route.fallback()));
    await second.goto('/workshop');
    // said by the chip, and by Workspace's import card when that page is open
    await expect(second.locator('.cloud-import-chip')).toContainText(/Another tab is importing\. Progress shows here too/, { timeout: 30_000 });
    held.release();
    await expect(songCount(page, 15)).toBeVisible({ timeout: 60_000 });
    expect(await second.evaluate((key) => localStorage.getItem(key), `selecta.import.${workspace}`)).toBeNull();
    await second.close();
  });

  test('offline app open or reload: the app opens from this device, says so, and the library is there', async ({ page, context, request }) => {
    const user = listener('nl-offline-open');
    const made = await seeded(request, user, { local_songs: 2, local_titles: ['Offline one', 'Offline two'] });
    await asLocalFirst(page, user);
    await connectOnThisDevice(page, made.workspace_id, [{ songId: made.local_songs[0], title: 'Offline one' }, { songId: made.local_songs[1], title: 'Offline two' }]);
    await page.goto('/library');
    await expect(page.getByText('Offline one').first()).toBeVisible();
    // the app-shell worker took control and the catalogue is kept
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration('/'))?.active)), { timeout: 30_000 }).toBe(true);
    await page.reload();
    await expect(page.getByText('Offline one').first()).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'You’re offline.' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Showing what this device knows/)).toBeVisible();
    await expect(page.getByText('Offline one').first()).toBeVisible();
    // a server-only action says why it waits
    await page.goto('/account').catch(() => undefined);
    await expect(page.getByText(/needs the internet/).first()).toBeVisible({ timeout: 30_000 });

    await context.setOffline(false);
    await expect(page.getByText('Back online. Catching up...')).toBeVisible({ timeout: 30_000 });
  });

  test('offline while playing: the music keeps going, and the lease is settled on reconnect', async ({ page, context, request }) => {
    const user = listener('nl-offline-play');
    const made = await seeded(request, user, { local_songs: 2, local_titles: ['Keeps one', 'Keeps two'] });
    await asLocalFirst(page, user);
    await connectOnThisDevice(page, made.workspace_id, [{ songId: made.local_songs[0], title: 'Keeps one', audio: true }, { songId: made.local_songs[1], title: 'Keeps two', audio: true }]);
    const held = heldOnADevice(page);
    await page.goto('/mixes');
    await held;
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/\/listen$/);
    const position = () => page.evaluate(() => (window as unknown as { __selectaEngineTime?: () => number }).__selectaEngineTime?.() ?? Number(document.querySelector('[data-song-time]')?.getAttribute('data-song-time') ?? 0));
    await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    expect((await request.post('/test/expire-lease', { data: { user } })).ok()).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'SelectaDJ keeps playing' }).first()).toBeVisible({ timeout: 30_000 });
    const before = await position();
    await page.waitForTimeout(3_000);
    // still playing past the lease: Pause is still the control, and nothing said it stopped
    await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();
    await expect(page.getByText(/could not renew its audio lease/)).toHaveCount(0);
    expect(await position()).toBeGreaterThanOrEqual(before);

    await context.setOffline(false);
    await expect(page.getByText('Back online. Catching up...')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible();
  });

  test('make or edit a mix offline: My Mixes says Waiting to sync, and it is sent on reconnect', async ({ page, context, request }) => {
    const user = listener('nl-outbox');
    const made = await seeded(request, user, { local_songs: 2, local_titles: ['Queue one', 'Queue two'] });
    await asLocalFirst(page, user);
    await connectOnThisDevice(page, made.workspace_id, [{ songId: made.local_songs[0], title: 'Queue one', audio: true }, { songId: made.local_songs[1], title: 'Queue two', audio: true }]);
    const held = heldOnADevice(page);
    await page.goto('/mixes/mine');
    await expect(page.getByRole('heading', { name: 'My Mixes' })).toBeVisible();
    await held;

    await context.setOffline(true);
    await page.goto('/mixes').catch(() => undefined);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Make a Mix', exact: true }).click().catch(() => undefined);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My Mixes' }).click().catch(async () => { await page.goto('/mixes/mine'); });
    await expect(page.getByText('Waiting to sync').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Saved on this device; it goes to your account when the connection is back\./).first()).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText('Waiting to sync')).toHaveCount(0, { timeout: 60_000 });
    const recipes = await page.evaluate(async () => {
      const user = localStorage.getItem('selecta-e2e-user');
      const account = await (await fetch('/api/account', { headers: { authorization: `Bearer e2e:${user}` } })).json();
      const answer = await fetch('/api/local-media/recipes', { headers: { authorization: `Bearer e2e:${user}`, 'x-workspace-id': account.workspace.id } });
      return (await answer.json()).recipes as unknown[];
    });
    expect(recipes.length).toBeGreaterThanOrEqual(1);
  });
});
