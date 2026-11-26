import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIndexedDb } from '../media/fakeIndexedDb';
import { assertNoPath } from '../media/identity';
import { MediaStore, resetLegacyDisposalForTests } from '../media/store';
import { bytesFile, fakeHandle } from '../media/testFixtures';
import { answerOtherDevices, playFromThisDeviceAgain } from './cloudOnly';
import { bindUploadQueue, endUploadQueue, previewUpload, startUpload, uploadSnapshot } from './cloudUploadQueue';
import { fakeUploadServer } from './testUploadServer';
import { uploadConsentFrom } from './uploadQueueWiring';

// What the upload queue sends (cloud.move_to_cloud). Uploads live in their own modules: only the
// upload routes and the presigned part PUTs the server handed out, never anything before the
// member agreed to the statement (the dry run the consent sheet shows is the one call before),
// no path in any body, and no device-to-account module ever imports them (plan "Egress tests").

/** Every request the upload modules may make, and nothing else. */
const ALLOWED: ReadonlyArray<[string, RegExp]> = [
  // the consent check: whether this workspace agreed to the statement
  ['GET', /^\/uploads\/rights$/],
  // the dry run, the plan with each song's id, and the unfinished sessions to carry on
  ['POST', /^\/uploads\/preview$/],
  ['POST', /^\/uploads\/plan$/],
  ['GET', /^\/uploads$/],
  ['GET', /^\/uploads\/s\d+$/],
  ['POST', /^\/uploads\/s\d+\/parts$/],
  ['POST', /^\/uploads\/s\d+\/complete$/],
  // letting a session's storage hold go
  ['DELETE', /^\/uploads\/s\d+$/],
];
const PRESIGNED = /^https:\/\/r2\.test\/put\/s\d+\/\d+$/;
/** The only keys a file spec carries. */
const SPEC_KEYS = new Set(['name', 'size', 'sha256', 'song_id', 'duration', 'content_type']);

const WS = 'ws-egress-up';
const hash = async (file: Blob) => `h-${await file.text()}`;

beforeEach(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDb());
  resetLegacyDisposalForTests();
});
afterEach(async () => {
  await endUploadQueue();
});

async function bound(consent: () => boolean) {
  const server = fakeUploadServer({ partSize: 3 });
  const store = await MediaStore.open(WS);
  for (const id of [1, 2]) {
    const file = bytesFile(`bytes of song ${id}`, `Artist - Song ${id}.flac`);
    await store.put({ songId: id, identity: { content_sha256: `h-bytes of song ${id}`, title: `Song ${id}`, artist: 'Artist', duration_s: 180 }, ref: { kind: 'handle', handle: fakeHandle(file) }, importedAt: id, sources: [{ folderId: 'f1', path: `Private Folder/Sub Dir/Artist - Song ${id}.flac`, size: file.size, modified: 5 }] });
  }
  const reports: number[] = [];
  bindUploadQueue({
    workspaceId: WS, api: server.api, openStore: async () => store, hasUploadConsent: async () => consent(), fetchImpl: server.fetchImpl, hash,
    retryDelay: () => 0, onAvailabilityChanged: () => { reports.push(1); },
    pacing: { locks: () => null, online: () => true, battery: async () => null, connection: () => null, phone: () => false },
  });
  await vi.waitFor(() => expect(uploadSnapshot().workspaceId).toBe(WS));
  return { server, store, reports };
}

function holdsTheContract(call: { method: string; path: string; body: unknown }) {
  expect(ALLOWED.some(([method, path]) => method === call.method && path.test(call.path)), `${call.method} ${call.path}`).toBe(true);
  if (call.body === undefined) return;
  expect(() => assertNoPath(call.body)).not.toThrow();
  const text = JSON.stringify(call.body);
  // a folder's place inside it never leaves the device; the file's own name does (uploads read
  // its kind from it), as every upload always has
  expect(text).not.toContain('Private Folder');
  expect(text).not.toContain('Sub Dir');
  expect(text).not.toMatch(/[\\/]/);
  for (const file of (call.body as { files?: Record<string, unknown>[] }).files ?? []) {
    for (const key of Object.keys(file)) expect(SPEC_KEYS.has(key), key).toBe(true);
  }
}

describe('what the upload queue sends', () => {
  it('only the upload routes and the presigned part PUTs, with no path in any body', async () => {
    const { server, reports } = await bound(() => true);
    await startUpload({ songIds: [1, 2] });
    await vi.waitFor(() => expect(uploadSnapshot().phase).toBe('finished'));
    expect(server.calls.length).toBeGreaterThan(0);
    server.calls.forEach(holdsTheContract);
    for (const put of server.puts) expect(put.url).toMatch(PRESIGNED);
    // the availability report goes through the shell's own reporter, never from here
    expect(reports.length).toBeGreaterThan(0);
  });

  it('sends nothing before the member agreed to the statement', async () => {
    let agreed = false;
    const { server } = await bound(() => agreed);
    expect(await startUpload({ songIds: [1, 2] })).toEqual({ ok: false, why: 'consent' });
    expect(server.calls).toEqual([]);
    expect(server.puts).toEqual([]);
    // the consent sheet's dry run is the one request before: names, sizes and hashes, no audio
    await previewUpload([1, 2]);
    expect(server.routes()).toEqual(['POST /uploads/preview']);
    server.calls.forEach(holdsTheContract);
    agreed = true;
    await startUpload({ songIds: [1, 2] });
    await vi.waitFor(() => expect(uploadSnapshot().phase).toBe('finished'));
    expect(server.routes()).toContain('POST /uploads/plan');
  });

  it('cloud only and its undo send nothing at all', async () => {
    const { server, store } = await bound(() => true);
    await answerOtherDevices(WS, 'cloud_only', [1], { openStore: async () => store });
    expect(store.isCloudOnly(1)).toBe(true);
    expect(await playFromThisDeviceAgain(1, { openStore: async () => store })).toBe('restored');
    expect(server.calls).toEqual([]);
    expect(server.puts).toEqual([]);
  });

  it('the consent check reads the statement route and nothing else', async () => {
    const asked: string[] = [];
    const api = (async (path: string, init?: RequestInit) => { asked.push(`${init?.method ?? 'GET'} ${path}`); return { applies: true, accepted: true }; }) as Parameters<typeof uploadConsentFrom>[0];
    expect(await uploadConsentFrom(api)(WS)).toBe(true);
    expect(asked).toEqual(['GET /uploads/rights']);
    const unanswered = (async () => ({ applies: true, accepted: false })) as Parameters<typeof uploadConsentFrom>[0];
    expect(await uploadConsentFrom(unanswered)(WS)).toBe(false);
    const down = (async () => { throw new Error('offline'); }) as Parameters<typeof uploadConsentFrom>[0];
    expect(await uploadConsentFrom(down)(WS)).toBe(false);
  });
});

// --- the import graph ------------------------------------------------------------------------

const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string; existsSync(path: string): boolean };
const pathOf = node.getBuiltinModule('node:path') as { resolve(...parts: string[]): string; dirname(path: string): string; relative(from: string, to: string): string };
const SRC = pathOf.resolve(node.cwd(), 'src');

/** The upload modules a device-to-account module must never reach. */
const UPLOAD_MODULES = ['cloud/cloudUploadQueue.ts', 'cloud/cloudUploadJournal.ts', 'cloud/cloudUploadPacing.ts', 'cloud/cloudUploadWords.ts', 'cloud/uploadQueueWiring.ts', 'cloud/UploadChip.tsx', 'cloud/uploadParts.ts', 'cloud/uploadConsent.ts'];
/** The device-to-account modules (deviceToAccount.egress.test.ts). */
const DEVICE_TO_ACCOUNT = ['accountFacts', 'accountMixes', 'accountRequests', 'accountPlacements', 'accountIdeas', 'accountOrder', 'accountSeams', 'recipeStore', 'deviceMusicRequest', 'deviceMusicRequests', 'accountDiscoveries', 'seamReports', 'studioWiring', 'factsUploader'];

function resolveImport(from: string, spec: string): string | null {
  const base = pathOf.resolve(pathOf.dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(candidate) && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every module `start` reaches through its relative imports (type-only imports count too). */
function reached(start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:import|export)[^'"]*?from\s*'(\.[^']+)'|import\(\s*'(\.[^']+)'\s*\)/g)) {
      const next = resolveImport(file, match[1] ?? match[2]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

describe('the upload modules stay apart', () => {
  it('no device-to-account module imports the upload queue, even through another module', () => {
    for (const name of DEVICE_TO_ACCOUNT) {
      const start = resolveImport(pathOf.resolve(SRC, 'cloud/x.ts'), `./${name}`);
      expect(start, name).not.toBeNull();
      const found = [...reached(start!)].map((file) => pathOf.relative(SRC, file).replace(/\\/g, '/'));
      for (const upload of UPLOAD_MODULES) expect(found, `${name} reaches ${upload}`).not.toContain(upload);
    }
  });
});
