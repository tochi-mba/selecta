import { expect, Page, test } from '@playwright/test';
import { listener } from './cloud';
import { asLocalFirst, mediaDbName, openLocalFirst, seeded } from './localFirst';

// BF-0462-04: the shared Library renders in local-first Cloud against the metadata catalogue
// (ADR-0458) and says where each song can play from. The catalogue, the device reports and the
// hosted copies are the real e2e server's; this device's connected files are real browser
// handles in IndexedDB, made from files in the origin-private file system (the same handle
// type a folder pick stores). "Needs permission again" cannot be produced here: a browser
// never revokes permission on its own private files, so that state is covered by Vitest
// (deviceMusicAvailability.test.ts) with a handle that asks again.

const row = (page: Page, title: string) => page.locator('li.song-row', { hasText: title });
/** A browser row's one status chip (02889fe5): whether it plays here, or the step that makes it.
 * Where it plays from rides in the chip's title. */
const chip = (page: Page, title: string) => row(page, title).locator('.lw-state .status');
const HOSTED = 'Plays from your cloud library in SelectaDJ.';

test('a grandfathered account sees hosted copies, songs on its other devices and songs on none', async ({ page, request }) => {
  const user = listener('lf-library-hosted');
  // "Song 1.wav" is a hosted copy; the catalogue's "Song 1" is that song by its exact name
  await seeded(request, user, { songs: 1, local_songs: 3, local_titles: ['Song 1', 'Away song', 'Lost song'], local_absent: 1 });
  await openLocalFirst(page, user, '/library', { hosted: true });

  await expect(chip(page, 'Song 1')).toHaveText('Ready');
  await expect(chip(page, 'Song 1')).toHaveAttribute('title', HOSTED);
  await expect(chip(page, 'Away song')).toHaveText('Not in this browser yet');
  await expect(chip(page, 'Away song')).toHaveAttribute('title', 'Choose your music folder in this browser to play it here.');
  await expect(chip(page, 'Lost song')).toHaveText('Missing');
  await expect(chip(page, 'Lost song')).toHaveAttribute('title', 'It is not on any of your devices right now. Connect it again to play it.');

  // the details panel's Play line gives the same answer as the row: not playable here
  await page.getByRole('button', { name: /^Details for Away song / }).click();
  await expect(page.getByRole('dialog', { name: 'Away song' })).toContainText('Not on this device');
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
    const fileFor = async (name: string, bytes: Uint8Array) => {
      const handle = await root.getFileHandle(name, { create: true });
      const writing = await handle.createWritable();
      await writing.write(bytes);
      await writing.close();
      return handle;
    };
    // a connected file's fingerprint is its bytes' own: a file whose bytes differ is a changed
    // file, and SelectaDJ stops counting it as this song (media/resolve.ts)
    const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const hereBytes = new Uint8Array([1, 2, 3, 4]);
    const here = await fileFor('here-song.wav', hereBytes);
    const moved = await fileFor('moved-song.wav', new Uint8Array([5, 6, 7, 8]));
    const hereSha = await sha256(hereBytes);
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
      songs.put({ songId: hereId, identity: { content_sha256: hereSha, title: 'Here song', artist: 'E2E Local' }, ref: { kind: 'handle', handle: here }, importedAt: Date.now() });
      songs.put({ songId: movedId, identity: { content_sha256: 'b'.repeat(64), title: 'Moved song', artist: 'E2E Local' }, ref: { kind: 'handle', handle: moved }, importedAt: Date.now() });
      writing.oncomplete = () => resolve();
      writing.onerror = () => reject(writing.error);
    });
    db.close();
  }, { hereId, movedId, dbName: mediaDbName(made.workspace_id) });

  await page.goto('/library');
  await expect(chip(page, 'Here song')).toHaveText('Ready');
  await expect(chip(page, 'Here song')).toHaveAttribute('title', 'The file is connected here and can play.');
  // its file no longer opens here, and the seeding device still reports it
  await expect(chip(page, 'Moved song')).toHaveText('Not in this browser yet');
  await expect(chip(page, 'Other song')).toHaveText('Not in this browser yet');
  // a new member has no hosted copies, so nothing claims one
  await expect(page.locator(`[title="${HOSTED}"]`)).toHaveCount(0);
  // and the row's answer holds once the files have been checked against their fingerprints
  await page.waitForTimeout(20_000);
  await expect(chip(page, 'Here song')).toHaveText('Ready');
});
