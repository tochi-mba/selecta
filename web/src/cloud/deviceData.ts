import { cacheClearAll, deleteDatabase, forgetFolder, MEDIA_DB_PREFIX, MediaStore } from '../media';
import { clearImportMarker } from './importSession';
import { forgetCached } from './offlineCache';

// What this browser keeps for an account, and how it is let go (ADR-0469).
//
// Signing out keeps a workspace's device data, so signing back in is instant; while another
// account is signed in it is simply unreachable, because every index is named by workspace and
// the server session decides which workspace is active. Deleting the account, or forgetting
// this device, wipes that workspace's song index, remembered folder and import marker. The
// content-keyed derived cache is a pure function of file bytes, holds no titles, ratings or
// history, and is shared by every account on this device, so it is only cleared by "clear
// everything". Source music files are never touched by any of this.

/** Workspace-scoped device keys removed with the workspace (the import marker has its own
 * helper): the media profile id and the device key the availability report uses. */
const WORKSPACE_KEYS = (workspaceId: string) => [
  `selecta.media-profile.${workspaceId}`,
  `selecta.device.${workspaceId}`,
];

/** Forget one workspace on this device: its song index, folder and import marker. */
export async function forgetWorkspaceOnDevice(workspaceId: string): Promise<void> {
  clearImportMarker(workspaceId);
  try {
    for (const key of WORKSPACE_KEYS(workspaceId)) localStorage.removeItem(key);
  } catch {
    // no storage to clear
  }
  await forgetFolder(workspaceId);
  await MediaStore.forget(workspaceId);
  // the kept catalogue and account snapshot for an offline open (cloud.offline_shell)
  await forgetCached(workspaceId);
}

/** The business venue offline cache's database (business/offline/zoneCache.ts). */
const ZONE_CACHE_DB = 'selectadj-zone-cache';

type DatabasesApi = { databases?: () => Promise<{ name?: string }[]> };

/** Every SelectaDJ media database this browser holds, by name. Where the browser cannot list
 * databases, only the named ones passed in are known. */
async function mediaDatabases(): Promise<string[]> {
  try {
    const listing = (indexedDB as unknown as DatabasesApi).databases;
    if (!listing) return [];
    const all = await listing.call(indexedDB);
    return all.map((db) => db.name ?? '').filter((name) => name === MEDIA_DB_PREFIX || name.startsWith(`${MEDIA_DB_PREFIX}-`));
  } catch {
    return [];
  }
}

/** localStorage prefixes "clear everything" removes. The sign-in itself is not here: clearing
 * device data must not be a way to lose the session mid-action, and signing out is its own
 * button. */
const DEVICE_PREFIXES = ['selecta.', 'selecta-now'];

/** Clear everything SelectaDJ keeps in this browser: every account's song index and folder,
 * the shared derived cache, import markers and on-device preferences. `known` names workspaces
 * to forget even where the browser cannot list its databases. */
export async function clearEverythingOnDevice(known: string[] = []): Promise<void> {
  for (const workspaceId of known) await forgetWorkspaceOnDevice(workspaceId);
  for (const name of await mediaDatabases()) await deleteDatabase(name);
  // The venue offline cache (business zones) is SelectaDJ data in this browser too.
  await deleteDatabase(ZONE_CACHE_DB);
  await cacheClearAll();
  try {
    const doomed: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && DEVICE_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // no storage to clear
  }
}
