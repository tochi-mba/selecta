import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registrationOf, resetSavedLengths, saveSongLength } from './songLength';

// T-20261125-8ab8: a decoded length is saved through the catalogue's own registration, once,
// changing nothing else about the song.

const row = { id: 7, content_sha256: 'a'.repeat(64), title: 'Song', artist: 'Kranium', album: null, duration_s: null, codec: 'mp4', sample_rate: 44100 };

beforeEach(() => resetSavedLengths());

describe('saving a length the catalogue lacks', () => {
  it('re-registers the row as it is, with the decoded length', async () => {
    const request = vi.fn(async (path: string) => (path === '/local-media/songs/7' ? row : { songs: [] }));
    expect(await saveSongLength(request as never, 7, 201.23456)).toBe(true);
    const [path, init] = request.mock.calls[1] as unknown as [string, RequestInit];
    expect(path).toBe('/local-media/songs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ songs: [{ content_sha256: 'a'.repeat(64), title: 'Song', artist: 'Kranium', duration_s: 201.235, codec: 'mp4', sample_rate: 44100 }] });
  });

  it('leaves a known length alone, tries each song once, and never throws', async () => {
    const known = vi.fn(async () => ({ ...row, duration_s: 199 }));
    expect(await saveSongLength(known as never, 7, 201)).toBe(false);
    expect(known).toHaveBeenCalledTimes(1);
    expect(await saveSongLength(known as never, 7, 201)).toBe(false);
    expect(known).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => { throw new Error('offline'); });
    expect(await saveSongLength(failing as never, 8, 201)).toBe(false);
    expect(await saveSongLength(failing as never, 9, 0)).toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('sends only the fields the row has', () => {
    expect(registrationOf({ ...row, codec: null, sample_rate: null }, 5)).toEqual({ content_sha256: 'a'.repeat(64), title: 'Song', artist: 'Kranium', duration_s: 5 });
  });
});
