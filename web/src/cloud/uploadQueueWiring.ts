import { useEffect, useRef } from 'react';
import type { MediaStore } from '../media/store';
import type { Api } from './api';
import { bindUploadQueue, startUpload } from './cloudUploadQueue';
import { bindUploadStart, uploadConsentCheck, type Request } from './uploadConsent';

// The shell's hook for the upload queue (`cloud.move_to_cloud`): binds it to the signed-in
// workspace, so a queue a reload left part way carries on, gives the consent sheet its start
// (`bindUploadStart`, uploadConsent.ts), and lets go on sign-out. Off, it does nothing at all.

/** The consent module's check (`GET /api/uploads/rights`), through the Cloud API for `workspaceId`. */
export function uploadConsentFrom(api: Api): (workspaceId: string) => Promise<boolean> {
  return uploadConsentCheck((workspaceId) => ((path: string, init?: RequestInit) => api(path.replace(/^\/api(?=\/)/, ''), init, workspaceId)) as Request);
}

let queueCleanup: Promise<void> = Promise.resolve();

export function useCloudUploadQueue(given: {
  on: boolean;
  storageRevision?: number;
  workspaceId: string;
  api: Api;
  openStore: () => Promise<MediaStore>;
  /** Song ids of the current and recent mixes, most important first. */
  mixSongs: () => readonly number[];
  playing: () => boolean;
  onAvailabilityChanged: () => void | Promise<void>;
}): void {
  // read when used, never as an effect dependency, so a new function each render costs nothing
  const latest = useRef(given);
  latest.current = given;
  const { on, workspaceId, api, openStore, storageRevision } = given;
  useEffect(() => {
    if (!on) return undefined;
    let active = true;
    let unbind: (() => Promise<void>) | undefined;
    const binding = queueCleanup.then(() => {
      if (!active) return;
      unbind = bindUploadQueue({
        workspaceId, api, openStore, storageRevision,
        hasUploadConsent: uploadConsentFrom(api),
        mixSongs: () => latest.current.mixSongs(),
        playing: () => latest.current.playing(),
        onAvailabilityChanged: () => latest.current.onAvailabilityChanged(),
      });
      bindUploadStart(async (songs, choice) => {
        const result = await startUpload({ songIds: songs.map((song) => song.songId), keepHere: choice.keepHere });
        if (!result.ok) throw new Error(result.why === 'nothing'
          ? 'These songs are already queued or no longer available on this device.'
          : 'SelectaDJ could not start this upload. Check your storage settings and try again.');
      });
    });
    return () => {
      active = false;
      bindUploadStart(null);
      queueCleanup = binding.then(() => unbind?.()).catch(() => undefined);
    };
  }, [on, workspaceId, api, openStore, storageRevision]);
}
