import { expect, test } from '@playwright/test';
import { inflateRawSync } from 'node:zlib';
import { reconcile, type CloudLibraryAsset, type LocalSong } from '../src/cloud/migration/ReconciliationPanel';
import { runImport, type Request } from '../src/media/importer';
import type { MediaStore, StoredSong } from '../src/media/store';
import { listener } from './cloud';

// BF-0465-02 (ADR-0465): the migration reconciliation, end to end over the e2e Cloud server
// (`pnpm e2e:reconcile`, playwright.reconcile.config.ts, which builds the local media catalogue on).
//
//   seed     a hosted library: three songs stored in Cloud (R2 originals plus playback files);
//   export   the member downloads the account export and reads its originals;
//   re-import two of those originals, byte for byte, go through the app's own importer
//            (media/importer.ts runImport), with a re-encoded "Song 3" (same name, other audio)
//            and one song that was never hosted;
//   report   the app's own reconcile() over exactly the two lists the panel reads.
//
// The report must be truthful (matched by content hash only: the same-named, different audio is
// not merged), every matched hosted song must resolve to a song this device holds, and the whole
// flow must write nothing to object storage and delete nothing anywhere.

type ZipEntry = { name: string; data: Buffer };

/** The entries of a small zip archive (the export is plain deflate, no ZIP64 at this size). */
function readZip(zip: Buffer): ZipEntry[] {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end -= 1;
  expect(end, 'zip end record').toBeGreaterThanOrEqual(0);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    at += 46 + skip;
  }
  return entries;
}

type R2Object = { bucket: string; key: string; size: number; sha256: string };

test('export, local re-import and identity matching give a truthful report, writing nothing to R2', async ({ page, request, baseURL }) => {
  const user = listener('reconcile');
  const auth = { Authorization: `Bearer e2e:${user}`, Origin: String(baseURL) };
  const seeded = await request.post('/test/seed', { data: { user, songs: 3, seconds: 3 } });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  const hostedIds = ((await seeded.json()) as { assets: string[] }).assets;
  expect(hostedIds).toHaveLength(3);
  const account = await (await request.get('/api/account', { headers: auth })).json();
  expect(account.features['cloud.local_media'], 'this build has the catalogue on').toBe(true);

  const objectsBefore = ((await (await request.get('/test/r2/objects')).json()) as { objects: R2Object[] }).objects;
  expect(objectsBefore.length).toBeGreaterThanOrEqual(3);
  await request.delete('/test/r2/log');

  // -- export ---------------------------------------------------------------------------------
  const exported = await request.get('/api/account/export', { headers: auth });
  expect(exported.ok(), await exported.text()).toBeTruthy();
  const entries = readZip(Buffer.from(await exported.body()));
  const manifest = JSON.parse(entries.find((entry) => entry.name === 'manifest.json')!.data.toString('utf8'));
  expect(manifest.asset_count).toBe(3);
  const listed = JSON.parse(entries.find((entry) => entry.name === 'assets.json')!.data.toString('utf8')) as { id: string; file: string; sha256: string }[];
  const original = (id: string) => entries.find((entry) => entry.name === listed.find((asset) => asset.id === id)!.file)!.data;
  const [first, second, third] = hostedIds;

  // -- re-import, through the app's own importer --------------------------------------------
  const calls: string[] = [];
  const api: Request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path.split('?')[0]}`);
    const answer = await fetch(new URL(path, baseURL), { ...init, method, headers: { ...auth, ...(init?.headers as Record<string, string> | undefined) } });
    const body = await answer.text();
    if (!answer.ok) throw new Error(`${method} ${path}: ${answer.status} ${body}`);
    return (body ? JSON.parse(body) : null) as T;
  };
  const held = new Map<number, StoredSong>();
  const store = { put: async (song: StoredSong) => { held.set(song.songId, song); } } as unknown as MediaStore;
  const reencoded = Buffer.from(await (await request.get('/test/wav?seconds=2')).body());
  const extra = Buffer.from(await (await request.get('/test/wav?seconds=1')).body());
  const file = (bytes: Buffer, name: string) => new File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
  const summary = await runImport({
    source: [file(original(first), 'Song 1.wav'), file(original(second), 'Song 2.wav'), file(reencoded, 'Song 3.wav'), file(extra, 'Rex - Night Drive.wav')],
    request: api,
    store,
    deviceId: 'reconcile-device',
  });
  expect(summary).toMatchObject({ imported: 4, failed: 0, cancelled: false, paused: false });

  // -- report: the panel's own reads, and the app's own matching ------------------------------
  const assets = (await api<{ assets: CloudLibraryAsset[] }>('/api/assets?limit=100', { method: 'GET' })).assets;
  const songs = (await api<{ songs: LocalSong[] }>('/api/local-media/songs?limit=100', { method: 'GET' })).songs;
  const rows = reconcile(assets, songs);
  const matched = rows.filter((row) => row.kind === 'matched');
  const hostedOnly = rows.filter((row) => row.kind === 'hosted_only');
  const deviceOnly = rows.filter((row) => row.kind === 'device_only');

  expect(matched.map((row) => row.asset.id).sort()).toEqual([first, second].sort());
  expect(hostedOnly.map((row) => row.asset.id)).toEqual([third]);
  // The same name with other audio is kept apart, and the report says why.
  expect(hostedOnly[0].reason).toContain('its audio is different');
  expect(deviceOnly.map((row) => row.song.title).sort()).toEqual(['Night Drive', 'Song 3']);
  for (const row of matched) {
    // Truthful: matched by content alone, and every matched hosted song resolves on this device.
    expect(row.song.content_sha256.toLowerCase()).toBe(row.asset.sha256!.toLowerCase());
    expect(held.get(row.song.id)?.identity.content_sha256, `${row.asset.name} is not on this device`).toBe(row.song.content_sha256);
  }

  // -- nothing written to R2, nothing deleted anywhere ----------------------------------------
  const objectsAfter = ((await (await request.get('/test/r2/objects')).json()) as { objects: R2Object[] }).objects;
  expect(objectsAfter).toEqual(objectsBefore);
  const r2 = ((await (await request.get('/test/r2/log')).json()) as { requests: { method: string }[] }).requests;
  expect(r2.filter((entry) => entry.method !== 'GET')).toEqual([]);
  expect(calls.filter((call) => !call.startsWith('GET ') && !call.startsWith('POST /api/local-media/'))).toEqual([]);
  expect((await api<{ assets: CloudLibraryAsset[] }>('/api/assets?limit=100')).assets.map((asset) => asset.id).sort()).toEqual([...hostedIds].sort());

  // -- the catalogue in the local-first shell: the `cloud.local_media` marks the flag sweep
  // checks for (flags.cloud.ts), shown here with the flag really on.
  await page.route('**/api/account', async (route) => {
    const answer = await route.fetch();
    const body = await answer.json();
    body.experience = { ...(body.experience ?? {}), local_first: true };
    body.features = { ...body.features, 'cloud.local_first': true };
    await route.fulfill({ response: answer, json: body });
  });
  await page.addInitScript((name) => localStorage.setItem('selecta-e2e-user', name), user);
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Connect music' })).toBeVisible();
  await expect(page.getByText('Night Drive').first()).toBeVisible();
});
