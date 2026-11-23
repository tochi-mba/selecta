import { describe, expect, it } from 'vitest';
import { advancing, bookOf, clock, entryAt, hasNext, previousTarget, remotePosition, remoteSession, sameProgramme, stateWords, upNext, whereWords, type RemoteSession } from './remoteNow';
import type { SessionState, SessionView } from './usePlaybackDevice';

// The pure rules behind the remote on Listen (flag devices.remote_control).

const session = (changes: Partial<SessionState> = {}): SessionState => ({
  mix_revision_id: null, song_index: 1, offset_ms: 20_000, anchor_at: 1000, state: 'playing', active_device_id: 'laptop', lease_expires_at: null, seq: 7,
  state_confidence: 'fresh', programme: [{ song_id: 11, sha256: 'a' }, { song_id: 12, sha256: 'b' }, { song_id: 13, sha256: 'c' }], ...changes,
});
const view = (changes: Partial<SessionView> = {}, state: Partial<SessionState> = {}): SessionView => ({
  session: session(state), speaker: 'elsewhere', speaker_device_id: 'laptop', speaker_name: 'Laptop', ask_before_playing_here: true, server_time: 1000, ...changes,
});
const remote = (seen: SessionView) => remoteSession(seen, true) as RemoteSession;
const book = bookOf([
  { id: 11, title: 'Alpha', artist: 'Rex', duration_s: 200 },
  { id: 12, title: 'Bravo', artist: 'Rex', duration_s: 180.4 },
  { id: 13, title: 'Charlie', artist: '', duration_s: null },
]);

describe('when a device is a remote', () => {
  it('needs the flag, another device as the speaker, and a programme', () => {
    expect(remoteSession(view(), true)).not.toBeNull();
    expect(remoteSession(view({ speaker: 'offline' }), true)).not.toBeNull();
    expect(remoteSession(view(), false)).toBeNull();
    expect(remoteSession(view({ speaker: 'here' }), true)).toBeNull();
    expect(remoteSession(view({ speaker: 'none' }), true)).toBeNull();
    expect(remoteSession(view({}, { programme: [] }), true)).toBeNull();
    expect(remoteSession(view({}, { programme: undefined }), true)).toBeNull();
    expect(remoteSession(view({ session: null }), true)).toBeNull();
    expect(remoteSession(null, true)).toBeNull();
  });

  it('knows when this device already holds the mix that is playing', () => {
    const programme = session().programme!;
    expect(sameProgramme(programme, [11, 12, 13])).toBe(true);
    expect(sameProgramme(programme, [11, 13, 12])).toBe(false);
    expect(sameProgramme(programme, [11, 12])).toBe(false);
    expect(sameProgramme(programme, [])).toBe(false);
  });
});

describe('the programme by title', () => {
  it('names a song from the library, with its length in milliseconds', () => {
    expect(entryAt(remote(view()), book, 1)).toEqual({ index: 1, songId: 12, title: 'Bravo', artist: 'Rex', durationMs: 180_400, known: true });
  });

  it('says "Song n of total" for a song the library does not have, never a blank', () => {
    expect(entryAt(remote(view()), new Map(), 1)).toEqual({ index: 1, songId: 12, title: 'Song 2 of 3', artist: '', durationMs: null, known: false });
  });

  it('keeps a missing length as not known, and a missing artist as unknown', () => {
    expect(entryAt(remote(view()), book, 2)).toMatchObject({ title: 'Charlie', artist: 'Unknown artist', durationMs: null, known: true });
  });

  it('lists what is after the current song, soonest first, and nothing past the end', () => {
    expect(upNext(remote(view({}, { song_index: 0 })), book).map((entry) => entry.title)).toEqual(['Bravo', 'Charlie']);
    expect(upNext(remote(view({}, { song_index: 0 })), book, 1).map((entry) => entry.index)).toEqual([1]);
    expect(upNext(remote(view({}, { song_index: 2 })), book)).toEqual([]);
    expect(hasNext(remote(view({}, { song_index: 1 })))).toBe(true);
    expect(hasNext(remote(view({}, { song_index: 2 })))).toBe(false);
  });
});

describe('the position', () => {
  it('moves from the anchor while a speaker that is checking in is playing', () => {
    const seen = view();
    expect(advancing(seen, remote(seen))).toBe(true);
    expect(remotePosition(seen, remote(seen), 1010, 180_000)).toBe(30_000);
  });

  it('stays inside the song when its length is known', () => {
    const seen = view();
    expect(remotePosition(seen, remote(seen), 5000, 180_000)).toBe(180_000);
    expect(remotePosition(seen, remote(seen), 5000, null)).toBe(4_020_000);
  });

  it('holds still when paused, when the speaker is offline, and when it has not checked in', () => {
    for (const seen of [view({}, { state: 'paused', anchor_at: null }), view({ speaker: 'offline' }), view({}, { state_confidence: 'uncertain' })]) {
      expect(advancing(seen, remote(seen))).toBe(false);
      expect(remotePosition(seen, remote(seen), 1010, 180_000)).toBe(20_000);
    }
  });
});

describe('Previous', () => {
  it('goes to the start of the song once it is more than three seconds in', () => {
    expect(previousTarget(remote(view()), 3001)).toEqual({ song_index: 1, offset_ms: 0 });
  });

  it('goes to the song before within the first three seconds', () => {
    expect(previousTarget(remote(view()), 3000)).toEqual({ song_index: 0, offset_ms: 0 });
    expect(previousTarget(remote(view()), 0)).toEqual({ song_index: 0, offset_ms: 0 });
  });

  it('restarts the first song, which has nothing before it', () => {
    expect(previousTarget(remote(view({}, { song_index: 0 })), 500)).toEqual({ song_index: 0, offset_ms: 0 });
  });
});

describe('the words', () => {
  it('say where the music is', () => {
    expect(whereWords(view())).toBe('Playing on Laptop');
    expect(whereWords(view({}, { state: 'paused' }))).toBe('Paused on Laptop');
    expect(whereWords(view({}, { state: 'stopped' }))).toBe('Stopped on Laptop');
    expect(whereWords(view({ speaker: 'offline' }))).toBe('Laptop is offline');
    expect(whereWords(view({ speaker_name: null }))).toBe('Playing on another device');
  });

  it('add an honest line only when the session is not plainly playing', () => {
    const playing = view();
    expect(stateWords(playing, remote(playing))).toBeNull();
    const offline = view({ speaker: 'offline' });
    expect(stateWords(offline, remote(offline))).toMatch(/Laptop may still be playing.*waits for it to come back/);
    const unsure = view({}, { state_confidence: 'uncertain' });
    expect(stateWords(unsure, remote(unsure))).toMatch(/has not checked in recently/);
    const stopped = view({}, { state: 'stopped' });
    expect(stateWords(stopped, remote(stopped))).toMatch(/stopped/);
  });

  it('write time as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_900)).toBe('1:05');
    expect(clock(-5)).toBe('0:00');
  });
});
