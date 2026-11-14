import { describe, expect, it } from 'vitest';
import {
  BrowserLocalCatalogue, availabilitySummary, describeRecording, mediaMime,
  resolveRecording, safeMediaLabel,
} from './localCatalogue';
import type { LocalRecording } from './types';

function recording(override: Partial<LocalRecording> = {}): LocalRecording {
  return {
    id: 'local-a', sourceId: 'drive-a', title: 'Song', artist: 'Artist',
    displayName: 'Song.mp3', mime: 'audio/mpeg', durationSeconds: 123,
    identity: { localId: 'local-a', exactSha256: 'aaa', bytes: 1234, lastModified: 1 },
    readiness: 'ready', reason: '', canonicalTrackId: null, version: 'clean', ...override,
  };
}

describe('BR64-02 private browser catalogue', () => {
  it('separates exact recording identity from canonical IDs and rejects different masters', () => {
    const records = [recording(), recording({ id: 'b', title: 'Song', version: 'live',
      identity: { localId: 'b', exactSha256: 'bbb', bytes: 1000, lastModified: 4 } })];
    expect(resolveRecording({ canonicalTrackId: 'cloud-track', exactSha256: 'aaa', bytes: 1234 }, records))
      .toMatchObject({ localRecordingId: 'local-a', state: 'ready', canonicalTrackId: 'cloud-track' });
    expect(resolveRecording({ canonicalTrackId: 'cloud-track', exactSha256: 'ccc', title: 'Song' }, records).state).toBe('candidate');
    expect(resolveRecording({ canonicalTrackId: 'cloud-track', title: 'Song', version: 'radio edit' }, records).state).toBe('version_mismatch');
  });
  it('keeps 5/8 readiness truthful and omits paths, hashes and names from Cloud summary', () => {
    const eight = [...Array(5)].map((_, n) => recording({ id: String(n) }))
      .concat(recording({ id: 'm1', readiness: 'missing' }), recording({ id: 'm2', readiness: 'missing' }), recording({ id: 'c', readiness: 'candidate' }));
    const result = availabilitySummary(eight, true);
    expect(result.total).toBe(8);
    expect(result.states.ready).toBe(5);
    const json = JSON.stringify(result);
    expect(json).not.toContain('Song');
    expect(json).not.toContain('sha');
    expect(json).not.toContain('local-a');
    expect(result.audio_output_verified).toBe(false);
  });
  it('detects picker formats without pretending DRM or private paths can be read', () => {
    expect(mediaMime({ name: 'track.flac', type: '' })).toBe('audio/flac');
    expect(mediaMime({ name: 'stream.spotify', type: 'application/octet-stream' })).toBeNull();
    expect(mediaMime({ name: 'track.aiff', type: '' })).toBe('audio/aiff');
    expect(describeRecording('Artist - Song (Live).mp3')).toMatchObject({ artist: 'Artist', version: 'live' });
    expect(safeMediaLabel('../../private/<bad>\u0000.mp3')).toBe('bad.mp3');
  });
  it('forgetting a binding never deletes the original', async () => {
    const catalogue = new BrowserLocalCatalogue('workspace-isolated');
    const input = new File(['music'], 'test.mp3', { type: 'audio/mpeg' });
    const source = await catalogue.scan([input], { origin: 'file_input' });
    catalogue.forgetSource(source.id);
    expect(catalogue.recordings).toHaveLength(0);
    expect(await input.text()).toBe('music');
  });
  it('bounds large batches and isolates workspaces', async () => {
    const catalogue = new BrowserLocalCatalogue('ws-a');
    const input = new File([], 'song.mp3', { type: 'audio/mpeg' });
    await expect(catalogue.scan(Array(20_001).fill(input), { origin: 'file_input' })).rejects.toThrow(/20,000/);
    expect(new BrowserLocalCatalogue('ws-b').recordings).toHaveLength(0);
  });
  it('cancels without reporting completed scans', async () => {
    const catalogue = new BrowserLocalCatalogue('abort');
    const controller = new AbortController();
    controller.abort();
    await expect(catalogue.scan([new File([], 'song.mp3')], {
      origin: 'file_input', signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(catalogue.sources[0].state).toBe('unknown');
  });
});
