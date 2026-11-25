import { expect, Page, test } from '@playwright/test';
import { listener } from './cloud';
import { asLocalFirst, mediaDbName, openLocalFirst, seeded } from './localFirst';

// BF-0462-04: the shared Library renders in local-first Cloud against the metadata catalogue
// (ADR-0458) and says where each song can play from. The catalogue, the device reports and the
// hosted copies are the real e2e server's; this device's connected files are real browser
// handles in IndexedDB, made from files in the origin-private file system (the same handle
// type a folder pick stores). "Needs permission again" cannot be produced here: a browser
// never revokes permission on its own private files, so that state is covered by Vitest
// (localFirstAvailability.test.ts) with a handle that asks again.

const row = (page: Page, title: string) => page.locator('li.song-row', { hasText: title });

test('a grandfathered account sees hosted copies, songs on its other devices and songs on none', async ({ page, request }) => {
  const user = listener('lf-library-hosted');
  // "Song 1.wav" is a hosted copy; the catalogue's "Song 1" is that song by its exact name
  await seeded(request, user, { songs: 1, local_songs: 3, local_titles: ['Song 1', 'Away song', 'Lost song'], local_absent: 1 });
  await openLocalFirst(page, user, '/library', { hosted: true });

  await expect(row(page, 'Song 1').getByText('Hosted copy')).toBeVisible();
  await expect(row(page, 'Away song').getByText('Not on this device')).toBeVisible();
  await expect(row(page, 'Away song').getByText('It is on another of your devices. Connect it here to play it here.')).toBeVisible();
  await expect(row(page, 'Lost song').getByText('Missing on every device')).toBeVisible();

  // the details panel's Play line gives the same answer as the row
  await page.getByRole('button', { name: /^Details for Away song / }).click();
  await expect(page.getByText('Not on this device').last()).toBeVisible();
});

test('a new local-first member sees the songs connected on this device as available here', async ({ page, request }) => {
  const user = listener('lf-library-here');
  const made = await seeded(request, user, { local_songs: 3, local_titles: ['Here song', 'Moved song', 'Other song'] });
  const [hereId, movedId] = made.local_songs;
  await asLocalFirst(page, user);
  // a same-origin page that is not the app, so the app has not opened its store yet
  await page.goto('/api/status');
  await page.evaluate(async ({ hereId, movedId, dbName }) => {
    const root = await navigator.storage.getDirectory();
    const fileFor = async (name: string) => {
      const handle = await root.getFileHandle(name, { create: true });
      const writing = await handle.createWritable();
      await writing.write(new Uint8Array([1, 2, 3, 4]));
      await writing.close();
      return handle;
    };
    const here = await fileFor('here-song.wav');
    const moved = await fileFor('moved-song.wav');
    // the file behind this handle goes away, as a moved or deleted file does
    await root.removeEntry('moved-song.wav');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(dbName, 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('songs', { keyPath: 'songId' });
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    await new Promise<void>((resolve, reject) => {
      const writing = db.transaction('songs', 'readwrite');
      const songs = writing.objectStore('songs');
      songs.put({ songId: hereId, identity: { content_sha256: 'a'.repeat(64), title: 'Here song', artist: 'E2E Local' }, ref: { kind: 'handle', handle: here }, importedAt: Date.now() });
      songs.put({ songId: movedId, identity: { content_sha256: 'b'.repeat(64), title: 'Moved song', artist: 'E2E Local' }, ref: { kind: 'handle', handle: moved }, importedAt: Date.now() });
      writing.oncomplete = () => resolve();
      writing.onerror = () => reject(writing.error);
    });
    db.close();
  }, { hereId, movedId, dbName: mediaDbName(made.workspace_id) });

  await page.goto('/library');
  await expect(row(page, 'Here song').getByText('On this device')).toBeVisible();
  // its file no longer opens here, and the seeding device still reports it
  await expect(row(page, 'Moved song').getByText('Not on this device')).toBeVisible();
  await expect(row(page, 'Other song').getByText('Not on this device')).toBeVisible();
  // a new member has no hosted copies, so nothing claims one
  await expect(page.getByText('Hosted copy')).toHaveCount(0);
});
