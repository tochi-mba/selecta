import type { CloudOnlyRecord, MediaStore } from '../media/store';
import { countOf } from '../ui/format';

// Playing a song from the cloud library only on this device (`cloud.move_to_cloud`, plan 6d).
//
// The member's file is never touched: the song's row leaves this device's index through
// `MediaStore.remove` (never `stopWatching(..., removeSongs)`, which takes the song out of the
// library), its whole row, handle and folder places are kept in the index's `in_cloud_only`
// store, and the account is told what this device holds now. Folder checks skip its unchanged
// file; a changed file that is still this song stays out too and is noted as a newer copy. "Play
// from this device again" puts the row back. A song playing right now keeps its decoded sound:
// the player asks the index for each song as it loads it, so the change applies from the next load.

export type CloudOnlyParts = {
  openStore: () => Promise<MediaStore>;
  /** Tell the account what this device holds now (a fresh availability report). */
  onAvailabilityChanged?: () => void | Promise<void>;
};

let bound: CloudOnlyParts | null = null;

/** The shell's parts, so "Play from this device again" can be called with a song id alone. */
export function bindCloudOnly(parts: CloudOnlyParts | null): void {
  bound = parts;
}

async function told(parts: CloudOnlyParts): Promise<void> {
  try { await parts.onAvailabilityChanged?.(); } catch { /* the shell's own report tries again */ }
}

/** Play `songId` from the cloud library only on this device. Only the upload queue calls this,
 * once the server accepted the upload for this very song. The availability report is left to the
 * caller, so a run of songs sends one report. */
export async function switchToCloudOnly(store: MediaStore, songId: number): Promise<CloudOnlyRecord | null> {
  return store.keepInCloudOnly(songId);
}

export type PlayHereAnswer =
  /** The song is on this device's list again and its file opens. */
  | 'restored'
  /** Back on the list, but its file needs choosing again (no handle, or the file moved). */
  | 'choose_again'
  /** This device has no record of it. */
  | 'not_found';

/** "Play from this device again": the row comes back from its record. */
export async function playFromThisDeviceAgain(songId: number, parts: CloudOnlyParts | null = bound): Promise<PlayHereAnswer> {
  if (!parts) return 'not_found';
  const store = await parts.openStore();
  const row = await store.playHereAgain(songId);
  if (!row) return 'not_found';
  await told(parts);
  if (row.ref.kind !== 'handle') return 'choose_again';
  try {
    await row.ref.handle.getFile();
    return 'restored';
  } catch {
    return 'choose_again';
  }
}

/** Whether this device plays `songId` from the cloud library only. */
export async function playsFromCloudOnly(songId: number, parts: CloudOnlyParts | null = bound): Promise<boolean> {
  if (!parts) return false;
  return (await parts.openStore()).isCloudOnly(songId);
}

/** The facts the song's details can say: it plays from the cloud library only here, and whether
 * a changed file on this device is still this song ("This device has a newer copy of this file"). */
export type CloudOnlyFacts = { cloudOnly: boolean; newerCopy: boolean; since: number | null };

export async function cloudOnlyFacts(songId: number, parts: CloudOnlyParts | null = bound): Promise<CloudOnlyFacts> {
  const record = parts ? (await parts.openStore()).cloudOnlyRecord(songId) : null;
  return { cloudOnly: record !== null, newerCopy: Boolean(record?.newerCopy), since: record?.at ?? null };
}

export const NEWER_COPY_WORDS = 'This device has a newer copy of this file.';

// --- The question for this device when another device uploaded its songs ---------------------

const answerKey = (workspaceId: string) => `selecta.uploads.other-devices.${workspaceId}`;

export type OtherDevicesAnswer = 'cloud_only' | 'keep';

export type OtherDevicesQuestion = { songIds: number[]; words: string };

export function otherDevicesWords(count: number): string {
  return count === 1
    ? '1 song on this device is now in your cloud library. Play it from your cloud library only?'
    : `${countOf(count, 'song')} on this device are now in your cloud library. Play them from your cloud library only?`;
}

export function otherDevicesAnswer(workspaceId: string): OtherDevicesAnswer | null {
  try {
    const said = localStorage.getItem(answerKey(workspaceId));
    return said === 'cloud_only' || said === 'keep' ? said : null;
  } catch {
    return null;
  }
}

/** Asked once per device: songs on this device that the account now has in its cloud library
 * (`inCloud`), uploaded from elsewhere (`except` holds what this device uploaded itself), when the
 * member has not answered before. Null when there is nothing to ask. The shell draws it. */
export async function otherDevicesQuestion(given: { store: MediaStore; workspaceId: string; inCloud: (songId: number) => boolean; except?: ReadonlySet<number> }): Promise<OtherDevicesQuestion | null> {
  if (otherDevicesAnswer(given.workspaceId) !== null) return null;
  const songIds = (await given.store.all()).map((song) => song.songId).filter((id) => given.inCloud(id) && !given.except?.has(id));
  return songIds.length ? { songIds, words: otherDevicesWords(songIds.length) } : null;
}

/** The member's answer, kept on this device; "Play them from your cloud library only" switches
 * each song and tells the account once. */
export async function answerOtherDevices(workspaceId: string, answer: OtherDevicesAnswer, songIds: readonly number[] = [], parts: CloudOnlyParts | null = bound): Promise<number> {
  try { localStorage.setItem(answerKey(workspaceId), answer); } catch { /* asked again next visit */ }
  if (answer !== 'cloud_only' || !parts || !songIds.length) return 0;
  const store = await parts.openStore();
  let switched = 0;
  for (const songId of songIds) if (await switchToCloudOnly(store, songId)) switched += 1;
  if (switched) await told(parts);
  return switched;
}
