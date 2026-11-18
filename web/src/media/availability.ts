import { assertNoPath } from './identity';
import type { Request } from './importer';
import { findLapsed } from './reauth';
import type { LapsedItem } from './reauth';
import type { MediaStore } from './store';

/** Incremental mismatch reports are chunked to 5,000 ids per list. */
export const AVAILABILITY_REPORT_BATCH = 5000;
/** Full replacement snapshots are one atomic request, capped to the catalogue's page ceiling. */
export const AVAILABILITY_SNAPSHOT_MAX_IDS = 20_000;

export type DeviceAvailabilitySnapshot = {
  present: number[];
  absent: number[];
};

/**
 * Reconcile the catalogue's device report with what this browser can currently open.
 * Permission-lapsed or missing handles and files that were only picked in a prior visit are
 * reported absent; session-only picks count as present until this page is closed.
 */
export async function deviceAvailabilitySnapshot(
  store: MediaStore,
  lapsedItems?: readonly LapsedItem[],
): Promise<DeviceAvailabilitySnapshot> {
  const songs = await store.all();
  const lapsed = new Set((lapsedItems ?? await findLapsed(store)).map((item) => item.songId));
  const present: number[] = [];
  const absent: number[] = [];
  for (const song of songs) {
    const canOpen = song.availabilityIssue !== 'changed' && (song.ref.kind === 'handle'
      ? !lapsed.has(song.songId)
      : store.sessionFile(song.songId) !== null);
    (canOpen ? present : absent).push(song.songId);
  }
  return { present, absent };
}

/**
 * Send only catalogue ids and the existing browser-profile device id. The authenticated
 * request is injected by the Cloud shell; this path never reads, serializes or uploads audio,
 * tags, filenames or file handles.
 */
export async function reportDeviceAvailability(
  request: Request,
  deviceId: string,
  snapshot: DeviceAvailabilitySnapshot,
  replace = false,
): Promise<void> {
  if (replace) {
    if (snapshot.present.length + snapshot.absent.length > AVAILABILITY_SNAPSHOT_MAX_IDS) {
      throw new Error(`Availability snapshot exceeds ${AVAILABILITY_SNAPSHOT_MAX_IDS} songs`);
    }
    const payload = {
      device_id: deviceId,
      present: snapshot.present,
      absent: snapshot.absent,
      snapshot: true,
    };
    assertNoPath(payload);
    // Always send one request, including an empty snapshot, so the server can replace its view
    // atomically and clear stale availability for tracks this device no longer has.
    await request('/api/local-media/availability', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return;
  }

  const count = Math.max(snapshot.present.length, snapshot.absent.length);
  for (let offset = 0; offset < count; offset += AVAILABILITY_REPORT_BATCH) {
    const payload = {
      device_id: deviceId,
      present: snapshot.present.slice(offset, offset + AVAILABILITY_REPORT_BATCH),
      absent: snapshot.absent.slice(offset, offset + AVAILABILITY_REPORT_BATCH),
    };
    assertNoPath(payload);
    await request('/api/local-media/availability', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

/** Snapshot and report in one operation, useful after re-authorization. */
export async function refreshDeviceAvailability(
  request: Request,
  store: MediaStore,
  deviceId: string,
  lapsedItems?: readonly LapsedItem[],
): Promise<{ snapshot: DeviceAvailabilitySnapshot; lapsed: LapsedItem[] }> {
  const lapsed = lapsedItems ? [...lapsedItems] : await findLapsed(store);
  const snapshot = await deviceAvailabilitySnapshot(store, lapsed);
  await reportDeviceAvailability(request, deviceId, snapshot, true);
  return { snapshot, lapsed };
}

