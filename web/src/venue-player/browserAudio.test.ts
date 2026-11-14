import { describe, expect, it, vi } from 'vitest';
import { BrowserVenueAudio } from './browserAudio';
import { publicRoomCatalogue, recordingAllowed, venueOpen, type VenuePolicy } from './policy';

const policy: VenuePolicy = {
  timezone: 'Europe/London', revision: 'p1', rightsAttested: true, rightsUntilEpochMs: null,
  openings: [{ day: 'sat', startMinute: 22 * 60, endMinute: 26 * 60 }],
  dayparts: [{ startMinute: 23 * 60, endMinute: 2 * 60, allowExplicit: false }],
  allowExplicit: true, blockedArtists: ['Blocked'],
};
const rec = { id: 'safe_1', artist: 'Artist', explicit: false, locallyAuthorised: true, exactRevisionVerified: true, blocked: false };
describe('BR64-08 browser venue safety', () => {
  it('evaluates overnight opening against the venue timezone', () => {
    expect(venueOpen(policy, Date.parse('2026-11-14T23:30:00Z'))).toBe(true);
    expect(venueOpen(policy, Date.parse('2026-11-15T01:30:00Z'))).toBe(true);
    expect(venueOpen(policy, Date.parse('2026-11-15T03:00:00Z'))).toBe(false);
  });
  it('evaluates spring DST and autumn repeated hour as local wall time, not UTC weekday', () => {
    const everySunday = { ...policy, openings: [{ day: 'sun' as const, startMinute: 60, endMinute: 180 }] };
    expect(venueOpen(everySunday, Date.parse('2026-03-29T01:30:00Z'))).toBe(true);
    expect(venueOpen(everySunday, Date.parse('2026-10-25T00:30:00Z'))).toBe(true);
    expect(venueOpen(everySunday, Date.parse('2026-10-25T01:30:00Z'))).toBe(true);
  });
  it('refuses unknown explicit flags, missing sources, rights expiry and unapproved dayparts', () => {
    const now = Date.parse('2026-11-14T23:30:00Z');
    expect(recordingAllowed(policy, rec, now)).toBe(true);
    expect(recordingAllowed(policy, { ...rec, explicit: null }, now)).toBe(false);
    expect(recordingAllowed(policy, { ...rec, locallyAuthorised: false }, now)).toBe(false);
    expect(recordingAllowed(policy, { ...rec, explicit: true }, now)).toBe(false);
    expect(recordingAllowed({ ...policy, rightsUntilEpochMs: now }, rec, now)).toBe(false);
  });
  it('never exposes paths, URLs or unapproved songs in guest catalogue', () => {
    const now = Date.parse('2026-11-14T23:30:00Z');
    expect(publicRoomCatalogue(policy, [
      { ...rec, title: 'Safe Song' },
      { ...rec, id: 'c:/private', title: 'Bad' },
      { ...rec, id: 'secret', title: 'file:///media/private' },
      { ...rec, id: 'blocked', artist: 'Blocked', title: 'Not permitted' },
    ], now)).toEqual([{ id: 'safe_1', artist: 'Artist', title: 'Safe Song' }]);
  });
  it('never treats an unlock or silent test alone as confirmed physical playback', async () => {
    const venue = new BrowserVenueAudio();
    expect(venue.playing()).toBe(false);
    expect(venue.snapshot().output).toBe('unverified');
    expect(venue.confirmHeard()).toBe(false);
    await venue.dispose();
  });
  it('refuses unverified and overlarge files before decoding', () => {
    const venue = new BrowserVenueAudio();
    const file = new File(['abc'], 'track.wav', { type: 'audio/wav' });
    expect(() => venue.importLocal([{ id: 'a', title: 'A', artist: 'B', file, revision: 'v1', permitted: false }])).toThrow();
    venue.importLocal([{ id: 'a', title: 'A', artist: 'B', file, revision: 'v1', permitted: true }]);
    expect(venue.snapshot().preparedMinutes).toBe(0);
    void venue.dispose();
  });
});
