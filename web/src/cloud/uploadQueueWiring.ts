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

export function useCloudUploadQueue(given: {
  on: boolean;
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
  const { on, workspaceId, api, openStore } = given;
  useEffect(() => {
    if (!on) return undefined;
    const unbind = bindUploadQueue({
      workspaceId, api, openStore,
      hasUploadConsent: uploadConsentFrom(api),
      mixSongs: () => latest.current.mixSongs(),
      playing: () => latest.current.playing(),
      onAvailabilityChanged: () => latest.current.onAvailabilityChanged(),
    });
    bindUploadStart(async (songs, choice) => { await startUpload({ songIds: songs.map((song) => song.songId), keepHere: choice.keepHere }); });
    return () => {
      bindUploadStart(null);
      unbind();
    };
  }, [on, workspaceId, api, openStore]);
}
