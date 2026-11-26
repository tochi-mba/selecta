import { useEffect, useRef } from 'react';
import type { MediaStore } from '../media/store';
import type { Api } from './api';
import { bindUploadQueue } from './cloudUploadQueue';

// The shell's hook for the upload queue (`cloud.move_to_cloud`): binds it to the signed-in
// workspace, so a queue a reload left part way carries on, and lets go on sign-out. Off, it does
// nothing at all.

/** Whether this workspace confirmed the upload statement, from `GET /api/uploads/rights` (plan
 * 6c). A business workspace confirms its own statement with each batch, so the queue (which is
 * for personal workspaces) never runs for it. Any trouble reads as no. */
export function uploadConsentFrom(api: Api): (workspaceId: string) => Promise<boolean> {
  return async (workspaceId) => {
    try {
      const answer = await api<{ applies?: boolean; accepted?: boolean }>('/uploads/rights', {}, workspaceId);
      return answer.applies !== false && answer.accepted === true;
    } catch {
      return false;
    }
  };
}

export function useCloudUploadQueue(given: {
  on: boolean;
  workspaceId: string;
  api: Api;
  openStore: () => Promise<MediaStore>;
  /** The consent module's check; the statement route by default. */
  hasUploadConsent?: (workspaceId: string) => Promise<boolean>;
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
    const fallback = uploadConsentFrom(api);
    return bindUploadQueue({
      workspaceId, api, openStore,
      hasUploadConsent: (id) => (latest.current.hasUploadConsent ?? fallback)(id),
      mixSongs: () => latest.current.mixSongs(),
      playing: () => latest.current.playing(),
      onAvailabilityChanged: () => latest.current.onAvailabilityChanged(),
    });
  }, [on, workspaceId, api, openStore]);
}
