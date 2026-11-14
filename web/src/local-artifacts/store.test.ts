import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalArtifactStore, storagePreflight } from './store';

const original = navigator.storage;
afterEach(() => Object.defineProperty(navigator, 'storage', { configurable: true, value: original }));
describe('browser quota admission', () => {
  it('rejects a partial write when staging+copy reserve cannot fit', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: vi.fn().mockResolvedValue({ quota: 10_000_000, usage: 9_000_000 }), persisted: async () => false, getDirectory: async () => { throw new Error('Not needed by quota-only tests'); } },
    });
    await expect(storagePreflight(4_000_000)).rejects.toMatchObject({ state: 'storage_pressure' });
  });
  it('does not discriminate against phones or assume quota is permanent', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: vi.fn().mockResolvedValue({ quota: 200_000_000, usage: 1_000_000 }), persisted: async () => false, getDirectory: async () => { throw new Error('Not needed by quota-only tests'); } },
    });
    const result = await storagePreflight(10_000_000);
    expect(result.available).toBe(199_000_000);
    expect(result.persistent).toBe(false);
  });
  it('reports unknown quota without pretending to know remaining storage', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true, value: { estimate: vi.fn().mockResolvedValue({}), persisted: async () => false, getDirectory: async () => { throw new Error('Not needed by quota-only tests'); } },
    });
    expect((await storagePreflight(4096)).available).toBeNull();
  });
});


describe('generated export cache recovery', () => {
  function fixture(files: Map<string, File>) {
    const directory = {
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!files.has(name)) {
          if (!options?.create) throw new DOMException('Missing cache file', 'NotFoundError');
          files.set(name, new File([], name));
        }
        return { getFile: async () => files.get(name)! };
      },
      removeEntry: async (name: string) => {
        if (!files.has(name)) throw new DOMException('Missing cache file', 'NotFoundError');
        files.delete(name);
      },
    };
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: async () => ({
          getDirectoryHandle: async () => directory,
        }),
      },
    });
    return new LocalArtifactStore();
  }

  it('removes orphan markers and incomplete generated audio without touching other files', async () => {
    const identity = 'a'.repeat(64);
    const key = identity + '.wav';
    const files = new Map<string, File>([
      [key + '.json', new File(['orphan marker'], key + '.json')],
      ['user-file.mp3', new File(['original'], 'user-file.mp3')],
    ]);
    const store = fixture(files);
    await store.cleanupIncomplete(identity, 'wav');
    expect(files.has(key + '.json')).toBe(false);
    expect(files.has('user-file.mp3')).toBe(true);
  });

  it('discards a corrupt generated audio/manifest pair without touching user-owned files', async () => {
    const identity = 'b'.repeat(64);
    const key = identity + '.wav';
    const audio = new File(['corrupt'], key);
    const files = new Map<string, File>([
      [key, audio],
      [key + '.json', new File([JSON.stringify({
        identity, codec: 'wav', bytes: audio.size, validated: true,
        createdAt: '2026-11-14T00:00:00Z',
        frames: 100, channels: 1, sampleRate: 44100, checksum: 0,
      })], key + '.json')],
      ['independent-mix.wav', new File(['saved'], 'independent-mix.wav')],
    ]);
    const store = fixture(files);
    expect(await store.get(identity, 'wav')).not.toBeNull();
    await store.discardInvalid(identity, 'wav');
    expect(files.has(key)).toBe(false);
    expect(files.has(key + '.json')).toBe(false);
    expect(files.has('independent-mix.wav')).toBe(true);
  });

  it('preserves valid cache pairs during incomplete-cache cleanup', async () => {
    const identity = 'c'.repeat(64);
    const key = identity + '.flac';
    const audio = new File(['encoded content'], key);
    const files = new Map<string, File>([
      [key, audio],
      [key + '.json', new File([JSON.stringify({
        identity, codec: 'flac', bytes: audio.size, validated: true,
        createdAt: '2026-11-14T00:00:00Z',
        frames: 100, channels: 1, sampleRate: 44100, checksum: 0,
      })], key + '.json')],
    ]);
    const store = fixture(files);
    await store.cleanupIncomplete(identity, 'flac');
    expect(files.has(key)).toBe(true);
    expect(files.has(key + '.json')).toBe(true);
  });
});
