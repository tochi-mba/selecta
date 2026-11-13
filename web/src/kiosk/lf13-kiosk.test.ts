import { describe, expect, it } from 'vitest';
import { stubAudio } from './audio';
import { kioskScreen, LOCAL_CODES } from './state';
import { sanitiseKioskView } from './view';
import type { KioskFacts } from './state';

const facts: KioskFacts = {
  paired: true, audioUnlocked: true, online: true, savedHoursAhead: 4, playingConfirmed: false,
};
const view = { state: 'open' as const, now: { title: 'Local Song', artist: 'Test Artist' } };

describe('LF13 kiosk truthful playback', () => {
  it('an unlocked AudioContext cannot prove music is playing', async () => {
    const audio = stubAudio(() => ({
      state: 'running',
      resume: async () => {},
      createBuffer: () => ({}),
      createBufferSource: () => ({ buffer: null, connect: () => {}, start: () => {} }),
      destination: {},
    }));
    expect(await audio.unlock()).toBe(true);
    expect(audio.playing()).toBe(false);
    expect(audio.savedHoursAhead()).toBe(0);
  });
  it('does not show Playing from an open server view without confirmed speaker output', () => {
    expect(kioskScreen(view, facts)).toEqual({ kind: 'problem', code: LOCAL_CODES.silent });
    expect(kioskScreen(view, { ...facts, playingConfirmed: true })).toEqual({ kind: 'playing', saved: false });
  });
  it('never calls saved offline music Playing without local playback evidence', () => {
    expect(kioskScreen(view, { ...facts, online: false })).toEqual({ kind: 'problem', code: LOCAL_CODES.problem });
    expect(kioskScreen(view, { ...facts, online: false, playingConfirmed: true })).toEqual({ kind: 'playing', saved: true });
    expect(kioskScreen(view, { ...facts, online: false, savedHoursAhead: 0, playingConfirmed: true }))
      .toEqual({ kind: 'problem', code: LOCAL_CODES.savedRanOut });
  });
  it('a user gesture is still required when audio has not unlocked', () => {
    expect(kioskScreen(view, { ...facts, audioUnlocked: false })).toEqual({ kind: 'needs_tap' });
  });
  it('rejects guest leakage of local paths, error traces and privileged fields', () => {
    const safe = sanitiseKioskView({
      state: 'open', venue_name: '/home/operator/music', zone_name: 'Terrace',
      now_playing: { title: 'C:\\Users\\Owner\\Music\\secret.flac', artist: 'Artist' },
      up_next: [{ title: 'Safe tune', artist: 'Safe artist' }],
      diagnostic_code: 'Bearer token', billing: { amount: 1000 },
      licence_number: 'PRIVATE', paths: ['/media/usb/song.flac'],
      error: 'Traceback (most recent call last):',
    });
    expect(safe.venue_name).toBeUndefined();
    expect(safe.now).toBeUndefined();
    expect(safe.zone_name).toBe('Terrace');
    expect(safe.next?.title).toBe('Safe tune');
    expect(safe.diagnostic_code).toBeUndefined();
    expect(JSON.stringify(safe)).not.toMatch(/secret|billing|licence|Traceback|PRIVATE/);
  });
  it('allows a short neutral kiosk diagnostic code, never raw exception text', () => {
    expect(sanitiseKioskView({ problem_code: 'K-204' }).diagnostic_code).toBe('K-204');
    expect(sanitiseKioskView({ problem_code: '/var/log/stack' }).diagnostic_code).toBeUndefined();
  });
});
