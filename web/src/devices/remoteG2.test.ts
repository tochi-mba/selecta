import { describe, expect, it } from 'vitest';
import { moveWords } from './RemoteMove';
import { movedFrom } from './playOn';
import type { SessionState } from './playbackWire';

// ADR-0475 G2 (58): what a device lacks is said before the music moves there, and the device
// taking over starts at the song that plays, wherever it sits in its own copy of the mix.

const session = (more: Partial<SessionState> = {}): SessionState => ({ mix_revision_id: null, song_index: 1, offset_ms: 40_000, anchor_at: 100, state: 'playing', active_device_id: 'laptop', lease_expires_at: 200, seq: 3, programme: [{ song_id: 7, sha256: 'a' }, { song_id: 8, sha256: 'b' }, { song_id: 9, sha256: 'c' }], ...more });

describe('moveWords', () => {
  it('says what will be skipped', () => {
    expect(moveWords(10, 10)).toBe('Has all 10 songs');
    expect(moveWords(8, 10)).toBe('Has 8 of 10 songs. 2 will be skipped.');
    expect(moveWords(9, 10)).toBe('Has 9 of 10 songs. 1 will be skipped.');
    expect(moveWords(0, 10)).toBe('Has none of these songs');
    expect(moveWords(null, 10)).toBe('Has music connected');
  });
});

describe('movedFrom', () => {
  it('starts at the playing song and its place, found by song in this copy', () => {
    expect(movedFrom(session(), [{ song_id: 8 }, { song_id: 9 }], 110)).toEqual({ song_index: 0, offset_ms: 50_000 });
    expect(movedFrom(session({ state: 'paused' }), [{ song_id: 7 }, { song_id: 8 }], 110)).toEqual({ song_index: 1, offset_ms: 40_000 });
    expect(movedFrom(session(), [{ song_id: 7 }, { song_id: 9 }], 110)).toBeNull();
    expect(movedFrom(null, [{ song_id: 7 }], 110)).toBeNull();
  });
});
