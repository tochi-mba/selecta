import { APIRequestContext, expect, Page } from '@playwright/test';

// Shared by the local-first cloud specs (ADR-0462/0463).
//
// The build ships `cloud.local_first` off by default and a per-user rule can never grant what
// the build denies (ADR-0414), so these specs turn it on for their one person by amending the
// account answer in the browser: the server's own decision is replaced only for the fields that
// make a local-first member (`experience`, `features["cloud.local_first"]`). The e2e build
// grandfathers every person into hosted media, so `experience.hosted` is set by the spec: false
// for a new local-first member, true for a grandfathered one. Everything else, including the
// catalogue songs and the catalogue routes (on in the e2e build), comes from the real e2e server.

export type Seed = {
  songs?: number;
  seconds?: number;
  local_songs?: number;
  local_titles?: string[];
  local_absent?: number;
};

export async function seeded(request: APIRequestContext, user: string, seed: Seed): Promise<{ workspace_id: string; local_songs: number[] }> {
  const answer = await request.post('/test/seed', { data: { user, ...seed } });
  expect(answer.ok(), await answer.text()).toBeTruthy();
  return await answer.json();
}

/** Sign in as `user` with the local-first experience on, without opening a page yet. */
export async function asLocalFirst(page: Page, user: string, { hosted = false }: { hosted?: boolean } = {}) {
  await page.route('**/api/account', async (route) => {
    try {
      const answer = await route.fetch();
      const account = await answer.json();
      account.experience = { ...(account.experience ?? {}), local_first: true, hosted };
      // and the flags that need cloud.local_first, which the server decides off for that reason
      // alone (the offline shell, the workspace and the mix outbox, dd62cd5a, came after this)
      account.features = { ...account.features, 'cloud.local_first': true, 'cloud.local_media': true, 'cloud.progressive_import': true, 'cloud.offline_shell': true, 'cloud.workspace': true, 'cloud.mix_outbox': true };
      await route.fulfill({ response: answer, json: account });
    } catch {
      // the test ended while an account refresh was in flight: nothing is waiting for it
    }
  });
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
}

/** Open `path` as `user`, with the local-first experience switched on for them. */
export async function openLocalFirst(page: Page, user: string, path: string, options: { hosted?: boolean } = {}) {
  await asLocalFirst(page, user, options);
  await page.goto(path);
}

/** The workspace's song index name, as media/store.ts mediaDbName makes it. */
export function mediaDbName(workspaceId: string): string {
  return `selecta-media-ws-${encodeURIComponent(workspaceId)}`;
}

export type DeviceSong = { songId: number; title: string; artist?: string; audio?: boolean; gone?: boolean };

/** Connect songs on this device the way a folder pick does: a real file handle per song, kept
 * in SelectaDJ's IndexedDB store. The files live in the origin-private file system (the only
 * place a test can make a real handle without a picker). `audio` writes a short real WAV, so
 * the browser engine can decode and play it; `gone` removes the file behind the handle, as a
 * moved or deleted file does. Call before the app has opened its store: it visits a same-origin
 * page that is not the app. The index is the workspace's own (ADR-0469, media/store.ts
 * mediaDbName); the unscoped legacy one is deleted by the app on its first open. */
export async function connectOnThisDevice(page: Page, workspaceId: string, songs: DeviceSong[]) {
  await page.goto('/api/status');
  await page.evaluate(async ({ wanted, dbName }) => {
    const wav = (seconds: number, tone: number) => {
      const rate = 22_050;
      const frames = Math.round(seconds * rate);
      const bytes = new DataView(new ArrayBuffer(44 + frames * 2));
      const text = (at: number, value: string) => { for (let i = 0; i < value.length; i += 1) bytes.setUint8(at + i, value.charCodeAt(i)); };
      text(0, 'RIFF'); bytes.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
      bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
      text(36, 'data'); bytes.setUint32(40, frames * 2, true);
      for (let frame = 0; frame < frames; frame += 1) bytes.setInt16(44 + frame * 2, Math.round(Math.sin((2 * Math.PI * tone * frame) / rate) * 8000), true);
      return bytes.buffer;
    };
    const root = await navigator.storage.getDirectory();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(dbName, 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('songs', { keyPath: 'songId' });
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    for (const [index, song] of wanted.entries()) {
      const name = `song-${song.songId}.wav`;
      const handle = await root.getFileHandle(name, { create: true });
      const writing = await handle.createWritable();
      await writing.write(song.audio ? wav(12, 220 + 60 * index) : new Uint8Array([1, 2, 3, 4]));
      await writing.close();
      if (song.gone) await root.removeEntry(name);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('songs', 'readwrite');
        tx.objectStore('songs').put({
          songId: song.songId,
          identity: { content_sha256: String(song.songId).padStart(64, '0'), title: song.title, artist: song.artist ?? 'E2E Local' },
          ref: { kind: 'handle', handle },
          importedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  }, { wanted: songs, dbName: mediaDbName(workspaceId) });
}
