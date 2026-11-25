// Typed calls for Rooms for Business (ADR-0451): each zone's standing room settings, the code and
// its rotation, pause and resume, removing or banning a guest, the print sheet, the on-screen
// code and the zone planner's next approved request. Every path is a route the server registers
// (tests/test_business_client_routes.py reads this file).

import type { Api } from '../../cloud/api';

export type RoomMode = 'staff_approve' | 'auto_accept' | 'off';
export type RoomLimits = { pending_per_guest: number; per_guest_per_hour: number; song_cooldown_min: number; pending_in_zone: number; accepted_per_hour: number; guests_at_once: number; expiry_min: number };
export type RoomView = {
  zone_id: string; zone_name: string; room_id: string; requests_on: boolean; mode: RoomMode; effective_mode: RoomMode;
  daypart_modes: Record<string, RoomMode>; paused: boolean; flood_switched: boolean; limits: RoomLimits;
  limit_ranges: Record<keyof RoomLimits, [number, number]>; code: string; join_path: string; code_version: number;
  welcome?: string | null; accent?: string | null; logo_url?: string | null; accent_used?: boolean; accent_reason?: string | null;
  screen_code_on?: boolean;
};
export type RoomChange = Partial<Pick<RoomView, 'requests_on' | 'mode' | 'daypart_modes' | 'welcome' | 'accent' | 'logo_url' | 'screen_code_on'>> & { limits?: Partial<RoomLimits> };
export type PrintSheet = { venue_id: string; venue_name: string; logo_url: string | null; zones: { zone_id: string; zone_name: string; code: string; join_url: string; view_only: boolean }[] };
export type ScreenCode = { on: boolean; code: string | null; changes_at: number | null };
export type NextRequest = { id: string; song_id: string; title: string; artist: string; votes: number; swapped: boolean; local_song_id: number | null };

const enc = encodeURIComponent;
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const ROOM_ROUTES = {
  room: (zone: string) => `/zones/${enc(zone)}/room`,
  rotate: (zone: string) => `/zones/${enc(zone)}/room/rotate`,
  pause: (zone: string) => `/zones/${enc(zone)}/room/pause`,
  resume: (zone: string) => `/zones/${enc(zone)}/room/resume`,
  remove: (zone: string, guest: string) => `/zones/${enc(zone)}/room/guests/${enc(guest)}/remove`,
  ban: (zone: string, guest: string) => `/zones/${enc(zone)}/room/guests/${enc(guest)}/ban`,
  print: (venue: string) => `/venues/${enc(venue)}/room-print`,
  screenCode: (zone: string) => `/zones/${enc(zone)}/room/screen-code`,
  next: (zone: string) => `/zones/${enc(zone)}/requests/next`,
  // ADR-0488: what the room does together
  social: (zone: string) => `/zones/${enc(zone)}/room/social`,
  rounds: (zone: string) => `/zones/${enc(zone)}/room/rounds`,
  cancelRound: (zone: string, round: string) => `/zones/${enc(zone)}/room/rounds/${enc(round)}/cancel`,
  recap: (zone: string) => `/zones/${enc(zone)}/room/recap`,
  displays: (zone: string) => `/zones/${enc(zone)}/room/displays`,
  display: (zone: string, display: string) => `/zones/${enc(zone)}/room/displays/${enc(display)}`,
  dedication: (zone: string, request: string) => `/zones/${enc(zone)}/requests/${enc(request)}/dedication`,
} as const;

export type SocialSettings = {
  keeps: boolean; reactions: boolean; rounds: boolean; round_seconds: number; round_every_songs: number;
  dedications: boolean; dedications_hidden: string[]; recap: boolean;
  screen_rounds: boolean; screen_reactions: boolean; screen_dedications: boolean; screen_recap: boolean;
};
export type SocialScreen = { id: string; label: string; online: boolean };
export type SocialView = {
  zone_id: string; settings: SocialSettings; on: Record<'keeps' | 'reactions' | 'rounds' | 'dedications' | 'recap', boolean>;
  lines: { id: string; words: string }[]; screens: SocialScreen[]; display_on: boolean;
};
export type RoundView = { round_id: string; state: string };

export function roomsClient(api: Api, workspaceId: string) {
  const call = <T,>(path: string, init?: RequestInit) => api<T>(path, init, workspaceId);
  return {
    room: (zone: string) => call<RoomView>(ROOM_ROUTES.room(zone)),
    change: (zone: string, change: RoomChange) => call<RoomView>(ROOM_ROUTES.room(zone), { method: 'PATCH', body: JSON.stringify(change) }),
    rotate: (zone: string) => call<{ code: string; join_path: string; warning: string }>(ROOM_ROUTES.rotate(zone), post()),
    pause: (zone: string) => call<unknown>(ROOM_ROUTES.pause(zone), post()),
    resume: (zone: string) => call<unknown>(ROOM_ROUTES.resume(zone), post()),
    remove: (zone: string, guest: string) => call<unknown>(ROOM_ROUTES.remove(zone, guest), post()),
    ban: (zone: string, guest: string, length: 'day' | 'week') => call<unknown>(ROOM_ROUTES.ban(zone, guest), post({ length })),
    print: (venue: string) => call<PrintSheet>(ROOM_ROUTES.print(venue)),
    screenCode: (zone: string) => call<ScreenCode>(ROOM_ROUTES.screenCode(zone)),
    next: async (zone: string) => (await call<{ request: NextRequest | null }>(ROOM_ROUTES.next(zone))).request,
    social: (zone: string) => call<SocialView>(ROOM_ROUTES.social(zone)),
    changeSocial: (zone: string, change: Partial<SocialSettings>) => call<SocialView>(ROOM_ROUTES.social(zone), { method: 'PATCH', body: JSON.stringify(change) }),
    startRound: (zone: string) => call<RoundView>(ROOM_ROUTES.rounds(zone), post()),
    cancelRound: (zone: string, round: string) => call<RoundView>(ROOM_ROUTES.cancelRound(zone, round), post()),
    recap: (zone: string) => call<{ lines: string[] }>(ROOM_ROUTES.recap(zone)),
    pairScreen: (zone: string, code: string) => call<{ screens: SocialScreen[] }>(ROOM_ROUTES.displays(zone), post({ pairing_code: code })),
    unpairScreen: (zone: string, display: string) => call<{ screens: SocialScreen[] }>(ROOM_ROUTES.display(zone, display), { method: 'DELETE' }),
    clearDedication: (zone: string, request: string) => call<unknown>(ROOM_ROUTES.dedication(zone, request), { method: 'DELETE' }),
  };
}

export type RoomsClient = ReturnType<typeof roomsClient>;

/** The full link a table card's QR code holds. */
export function joinUrl(path: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${path}`;
}
