import { describe, expect, it } from 'vitest';
import { audioId, audioIdOfBytes, fileIdentity } from './audioIdentity';

// The shared fixtures (tools/audio_identity_fixtures.py writes them, and checks every expected id
// against the payload it embedded): the browser must give exactly the ids the Python
// implementation gives, so a song is the same song on Desktop and in Cloud.

// Same disk access as stretch.test.ts: the app's tsconfig has no Node types. Vitest runs in web/.
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const FOLDER = `${node.cwd()}/../tests/fixtures/audio_identity`;

type Entry = { file: string; group: string | null; audio_id: string | null; size: number; bytes: string };
const manifest = JSON.parse(fs.readFileSync(`${FOLDER}/manifest.json`, 'utf8')) as { version: string; files: Entry[] };

// The bytes travel in the manifest as base64: the repo ignores audio file names on purpose.
const bytesOf = (entry: Entry) => Uint8Array.from(atob(entry.bytes), (char) => char.charCodeAt(0));
const blobOf = (entry: Entry) => new Blob([bytesOf(entry) as BlobPart]);

describe('audio id fixtures', () => {
  it('reads the a1 manifest with every kind of file in it', () => {
    expect(manifest.version).toBe('a1');
    expect(manifest.files.length).toBeGreaterThan(40);
    expect(manifest.files.some((entry) => entry.audio_id === null)).toBe(true);
  });

  for (const entry of manifest.files) {
    it(`${entry.file}: ${entry.audio_id ? 'the shared id' : 'no id'}, from a file and from bytes`, async () => {
      expect(bytesOf(entry).length).toBe(entry.size);
      expect(await audioId(blobOf(entry))).toBe(entry.audio_id);
      expect(await audioIdOfBytes(bytesOf(entry))).toBe(entry.audio_id);
    });
  }

  it('gives one id to every file of a group, and different groups different ids', () => {
    const groups = new Map<string, Set<string | null>>();
    for (const entry of manifest.files) {
      if (!entry.group) continue;
      groups.set(entry.group, (groups.get(entry.group) ?? new Set()).add(entry.audio_id));
    }
    for (const ids of groups.values()) expect(ids.size).toBe(1);
    const all = [...groups.values()].map((ids) => [...ids][0]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives the file hash and the audio id together, whole or streamed', async () => {
    const entry = manifest.files.find((one) => one.file === 'mp3-a-every-tag.mp3')!;
    const digest = await crypto.subtle.digest('SHA-256', bytesOf(entry) as BufferSource);
    const sha = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(await fileIdentity(blobOf(entry))).toEqual({ sha, audioId: entry.audio_id });
  });
});
