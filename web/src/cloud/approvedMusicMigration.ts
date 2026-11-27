import { useEffect } from 'react';
import type { MediaStore } from '../media/store';
import { startUpload, uploadSnapshot } from './cloudUploadQueue';
import { useUploadQueue } from './UploadChip';

const memory = new Map<string, number>();
const approvalKey = (workspaceId: string) => `selecta.music-migration.${encodeURIComponent(workspaceId)}`;

export function approveMusicMigration(workspaceId: string, revision: number): void {
  const key = approvalKey(workspaceId);
  try { localStorage.setItem(key, String(revision)); memory.delete(key); } catch { memory.set(key, revision); }
}

function approved(key: string, revision: number): boolean {
  try { return localStorage.getItem(key) === String(revision) || memory.get(key) === revision; }
  catch { return memory.get(key) === revision; }
}

function consumeApproval(key: string, revision: number): void {
  if (memory.get(key) === revision) memory.delete(key);
  try {
    if (localStorage.getItem(key) === String(revision)) localStorage.removeItem(key);
  } catch { /* private storage */ }
}

export function useApprovedMusicMigration(
  workspaceId: string,
  revision: number | undefined,
  openStore: () => Promise<MediaStore>,
): void {
  const queue = useUploadQueue(workspaceId);
  useEffect(() => {
    if (revision === undefined || queue.workspaceId !== workspaceId || queue.phase !== 'idle') return;
    const key = approvalKey(workspaceId);
    let active = true;
    const enqueue = async () => {
      if (!active || !approved(key, revision)) return;
      const songs = await (await openStore()).all();
      if (!active || uploadSnapshot().workspaceId !== workspaceId || !approved(key, revision)) return;
      if (!songs.length) {
        consumeApproval(key, revision);
        return;
      }
      const answer = await startUpload({ songIds: songs.map((song) => song.songId), keepHere: true });
      if (answer.ok || answer.why === 'nothing') consumeApproval(key, revision);
    };
    const attempt = () => {
      const pending = typeof navigator.locks?.request === 'function'
        ? navigator.locks.request(key, enqueue)
        : enqueue();
      void pending.catch(() => undefined);
    };
    attempt();
    window.addEventListener('online', attempt);
    return () => {
      active = false;
      window.removeEventListener('online', attempt);
    };
  }, [workspaceId, revision, openStore, queue.workspaceId, queue.phase]);
}
