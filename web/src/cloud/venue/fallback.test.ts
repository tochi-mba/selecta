import { describe, expect, it } from 'vitest';
import { fallbacksFor, isVenueDeepLink, preflight } from './fallback';

describe('controller fallback places (BF-0460-07)', () => {
  it('points each place at the shell the account uses', () => {
    const hosted = fallbacksFor({ localFirst: false, devices: true, rooms: true, library: true });
    expect(hosted.map((place) => [place.id, place.href])).toEqual([['controller', '/listen'], ['guest', '/listen'], ['library', '/library']]);
    const local = fallbacksFor({ localFirst: true, devices: true, rooms: true, library: true });
    expect(local.map((place) => place.href)).toEqual(['/account/devices', '/rooms', '/library']);
  });

  it('offers only places that are on for the account', () => {
    expect(fallbacksFor({ localFirst: true, devices: false, rooms: false, library: true }).map((place) => place.id)).toEqual(['library']);
    expect(fallbacksFor({ localFirst: true, devices: false, rooms: false, library: false })).toEqual([]);
  });

  it('knows the venue deep link and pre-flights by feature detection only', () => {
    expect(isVenueDeepLink('#venue')).toBe(true);
    expect(isVenueDeepLink('#other')).toBe(false);
    expect(preflight({})).toMatchObject({ ok: false });
    expect(preflight({ AudioContext: function Context() {} })).toMatchObject({ ok: false, reason: expect.stringMatching(/AudioWorklet/) });
    expect(preflight({ AudioContext: function Context() {}, AudioWorkletNode: function Node() {} })).toEqual({ ok: true });
  });
});
