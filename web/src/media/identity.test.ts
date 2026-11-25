import { describe, expect, it } from 'vitest';
import { assertNoPath, fileSha256, normalise } from './identity';

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('fileSha256', () => {
  it('matches the known vector for "abc"', async () => {
    expect(await fileSha256(new Blob(['abc']))).toBe(ABC);
    expect(await fileSha256(new Blob([new Uint8Array([0x61, 0x62, 0x63])]))).toBe(ABC);
  });

  it('matches the known vector for an empty file', async () => {
    expect(await fileSha256(new Blob([]))).toBe(EMPTY);
  });

  it('hashes the same whatever the slice size, so streaming never changes identity', async () => {
    const bytes = new Blob(['the same song, sliced small']);
    const whole = await fileSha256(bytes);
    expect(await fileSha256(bytes, { chunkSize: 2 })).toBe(whole);
    expect(await fileSha256(bytes, { chunkSize: 5 })).toBe(whole);
  });

  it('gives the same digest from WebCrypto and from the streamed hash that yields between pieces', async () => {
    const bytes = new Uint8Array(700 * 1024).map((_, index) => (index * 31) & 255);
    const blob = new Blob([bytes]);
    expect(await fileSha256(blob, { chunkSize: 4 * 1024 * 1024 })).toBe(await fileSha256(blob));
  });

  it('stops with AbortError when the import is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fileSha256(new Blob(['abc']), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('normalise', () => {
  it('trims and collapses whitespace, keeping case as written', () => {
    expect(normalise({ title: '  Deep   Cover ', artist: ' MF DOOM ', album: ' Operation  Doomsday ' }))
      .toEqual({ title: 'Deep Cover', artist: 'MF DOOM', album: 'Operation Doomsday' });
  });

  it('omits an empty album instead of sending an empty string', () => {
    expect(normalise({ title: 'A', artist: 'B', album: '   ' })).toEqual({ title: 'A', artist: 'B' });
    expect(normalise({ title: 'A', artist: 'B' })).toEqual({ title: 'A', artist: 'B' });
  });

  it('turns missing fields into empty strings rather than undefined', () => {
    expect(normalise({})).toEqual({ title: '', artist: '' });
  });
});

describe('assertNoPath', () => {
  it('lets a clean registration payload through', () => {
    const payload = { songs: [{ content_sha256: 'aa', title: 'A', artist: 'B', duration_s: 10 }] };
    expect(() => assertNoPath(payload)).not.toThrow();
  });

  it('catches a path key at the top level', () => {
    expect(() => assertNoPath({ path: 'C:/Music/song.mp3' })).toThrow(/path/i);
  });

  it('catches a path key buried in a nested array', () => {
    const payload = { songs: [{ content_sha256: 'aa', title: 'A', meta: { webkitRelativePath: 'Music/song.mp3' } }] };
    expect(() => assertNoPath(payload)).toThrow(/webkitRelativePath/);
  });

  it('catches the whole family of path-shaped keys regardless of case', () => {
    for (const key of ['Path', 'file_path', 'fullPath', 'relativePath', 'sourcePath', 'musicDirectory', 'sourceFolder']) {
      expect(() => assertNoPath({ [key]: 'x' })).toThrow(/never leave this device/);
    }
  });

  it('does not mind a title that merely contains slashes', () => {
    expect(() => assertNoPath({ title: 'AC/DC - Back In Black' })).not.toThrow();
  });
});
