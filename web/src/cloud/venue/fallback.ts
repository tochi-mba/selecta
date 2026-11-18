/** Controller fallbacks for devices that cannot be the player (ADR-0460, BF-0460-07).
 *
 * WebView and in-app browsers, TVs and anything whose probes fail still get somewhere useful:
 * controlling a player on another device, the room's guest request page, and the library. The
 * reason this device cannot play is always shown beside them, and a deep link to a player-only
 * place (the venue flow) explains itself and offers these instead of a dead end.
 */

export type FallbackId = 'controller' | 'guest' | 'library';
export type Fallback = { id: FallbackId; label: string; about: string; href: string };

/** Which of the account's places are on, and which shell draws them (paths differ). */
export type FallbackContext = { localFirst: boolean; devices: boolean; rooms: boolean; library: boolean };

export function fallbacksFor(context: FallbackContext): Fallback[] {
  const places: Fallback[] = [];
  if (context.devices) {
    places.push({
      id: 'controller',
      label: 'Control a player on another device',
      about: 'Use this device as the remote: pick songs and press play, pause or skip while another tablet or computer plays.',
      href: context.localFirst ? '/account/devices' : '/listen',
    });
  }
  if (context.rooms) {
    places.push({
      id: 'guest',
      label: 'Show the request room',
      about: 'Put your room’s request page on this screen so guests can see the code and add requests.',
      href: context.localFirst ? '/rooms' : '/listen',
    });
  }
  if (context.library) {
    places.push({
      id: 'library',
      label: 'Browse your library',
      about: 'Look through your music, fix details and plan the next set.',
      href: '/library',
    });
  }
  return places;
}

export const VENUE_HASH = '#venue';

/** Whether the address is a deep link to the venue flow. */
export function isVenueDeepLink(hash: string): boolean {
  return hash.toLowerCase() === VENUE_HASH;
}

type AudioScope = { AudioContext?: unknown; AudioWorkletNode?: unknown };

/** What can be known before any press, by feature detection alone: a browser with no Web Audio or
 * no AudioWorklet can never pass the probe, so a deep link says so at once. Passing this proves
 * nothing; the real probe still runs from the "Check this tablet" press. */
export function preflight(scope: AudioScope = globalThis as unknown as AudioScope): { ok: true } | { ok: false; reason: string } {
  if (typeof scope.AudioContext !== 'function') return { ok: false, reason: 'This browser has no Web Audio, so SelectaDJ cannot play here.' };
  if (typeof scope.AudioWorkletNode !== 'function') return { ok: false, reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' };
  return { ok: true };
}
