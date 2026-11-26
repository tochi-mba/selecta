import { useMemo } from 'react';
import type { Request } from '../api';
import { navigate } from '../router';
import type { LibraryPlacesChrome, RemovedFromCloud } from '../views/LibraryPlaces';
import { forgetCloudLibraryAssets, LIBRARY_CHANGED_EVENT } from './cloudLibraryMedia';
import { CATALOGUE_CHANGED_EVENT } from './deviceMusicRequest';
import { groupingFor } from './songVersions';

/** library.places in CloudShell: the Library's places chrome, and removing songs from the cloud
 * library (`POST /api/assets/remove`, catalogue ids only: no path, file or audio leaves). */

// the server's limit on one removal (routes/cloud_assets.py MAX_REMOVE)
const MOST_EACH_TIME = 200;

/** Remove songs from the cloud library: every version's copies go, so a grouped song is gone
 * from there whole. The answer is folded back into the songs the Library shows. */
export async function removeFromCloud(cloud: Request, workspaceId: string, songIds: readonly number[]): Promise<RemovedFromCloud> {
  const grouping = groupingFor(workspaceId);
  const files = [...new Set(songIds.flatMap((id) => grouping.versionsOf(id)))];
  const answers: RemovedFromCloud[] = [];
  for (let start = 0; start < files.length; start += MOST_EACH_TIME) {
    answers.push(await cloud<RemovedFromCloud>('/assets/remove', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ song_ids: files.slice(start, start + MOST_EACH_TIME) }),
    }));
  }
  const byFile = new Map(answers.flatMap((answer) => answer.songs).map((song) => [song.id, song]));
  const songs = songIds.map((id) => {
    const found = grouping.versionsOf(id).map((file) => byFile.get(file)).filter((song) => song?.found);
    return found.length
      ? { id, found: true, removed: found.reduce((sum, song) => sum + (song?.removed ?? 0), 0), left_nowhere: found.every((song) => song?.left_nowhere) }
      : { id, found: false };
  });
  // the uploads and the catalogue are read again, here and by the Library
  forgetCloudLibraryAssets(workspaceId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CATALOGUE_CHANGED_EVENT));
    window.dispatchEvent(new Event(LIBRARY_CHANGED_EVENT));
  }
  return { songs, bytes_released: answers.reduce((sum, answer) => sum + answer.bytes_released, 0) };
}

/** The chrome the Library reads, or null when library.places is off for this account. */
export function useLibraryPlaces({ on, cloud, workspaceId, accountId, canUpload, offline, otherDevices }: {
  /** library.places, with stored media readable and a cloud library to show */
  on: boolean;
  cloud: Request;
  workspaceId: string;
  accountId: string;
  canUpload: boolean;
  offline: boolean;
  otherDevices: boolean;
}): LibraryPlacesChrome | null {
  return useMemo(() => (on ? {
    accountId, otherDevices, canUpload, offline,
    removeFromCloud: (songIds: readonly number[]) => removeFromCloud(cloud, workspaceId, songIds),
    upload: () => navigate('/upload'),
  } : null), [on, cloud, workspaceId, accountId, canUpload, offline, otherDevices]);
}
