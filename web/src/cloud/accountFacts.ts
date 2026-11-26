import { flagListed } from '../flags';
import { TimeoutError } from './resilientRequest';

/** Which of the account's songs have measurements in the account, and the switch for everything
 * that sends this device's measurements or plans from them (docs/engineering/device-to-account.md).
 *
 * Read with `GET /api/song-facts`, a page at a time, once a session per workspace; the uploader
 * notes each song it saves, so the list stays current without asking again. Kept in memory only.
 */

export type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Who measured one song in the account (`facts_store.measured`). */
export type Measured = { implementation: string; source: string };

/** Sending measurements needs both flags, each named on by the server: an older server that
 * mentions neither would otherwise read as on (flags.ts `flagListed`). */
export const sendingOn = (): boolean => flagListed('cloud.brain') && flagListed('cloud.device_analysis');

/** Planning from the account (the order of a mix, each transition) needs the same two: the
 * planner reads the measurements this device sent, and the live engine plays its choices on the
 * beat grids this device measured. With either off the browser plans as before. */
export const planningOn = sendingOn;

/** The account's largest page (`facts_store.MAX_PAGE`). */
const PAGE = 1000;
/** A session's list is asked again after this long, for songs measured on another device. */
export const MEASURED_KEEP_MS = 10 * 60_000;

type Kept = { at: number; list: Promise<Map<number, Measured>> };
const kept = new Map<string, Kept>();

async function readAll(request: Request): Promise<Map<number, Measured>> {
  const found = new Map<number, Measured>();
  let after = 0;
  for (;;) {
    const page = await request<{ songs: { song_id: number; implementation: string; source: string }[]; next?: number | null }>(`/song-facts?after=${after}&limit=${PAGE}`);
    for (const song of page.songs) found.set(song.song_id, { implementation: song.implementation, source: song.source });
    // a cursor that doesn't move on would ask for the same page for ever
    if (page.next === undefined || page.next === null || !(page.next > after) || !page.songs.length) break;
    after = page.next;
  }
  return found;
}

/** The account's measured songs for this workspace. A failed read is forgotten, so the next
 * caller asks again; the caller decides what a failure means (today's behaviour, always). */
export function accountMeasured(request: Request, workspaceId: string, now: number = Date.now()): Promise<Map<number, Measured>> {
  const known = kept.get(workspaceId);
  if (known && now - known.at < MEASURED_KEEP_MS) return known.list;
  const list = readAll(request);
  kept.set(workspaceId, { at: now, list });
  list.catch(() => { if (kept.get(workspaceId)?.list === list) kept.delete(workspaceId); });
  return list;
}

/** The uploader saved (or the account already outranked) this song's measurements. */
export function noteMeasured(workspaceId: string, songId: number, measured: Measured): void {
  const known = kept.get(workspaceId);
  if (!known) return;
  const next = known.list.then((list) => list.set(songId, measured));
  // a failed read stays failed: one saved song is not the account's whole list
  next.catch(() => undefined);
  known.list = next;
}

/** `request`'s answer, or a TimeoutError once `ms` have passed with none. The request is told to
 * stop as well, and the race holds the bound even for a request that ignores being told. */
export async function askWithin<T>(request: Request, path: string, init: RequestInit, ms: number): Promise<T> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller?.abort(); reject(new TimeoutError()); }, ms);
  });
  try {
    return await Promise.race([request<T>(path, controller ? { ...init, signal: controller.signal } : init), limit]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Test seam, and sign-out: forget every list. */
export function forgetAccountMeasured(): void {
  kept.clear();
}
