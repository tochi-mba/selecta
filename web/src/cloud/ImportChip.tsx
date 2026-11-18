import { useEffect, useState } from 'react';
import { Status } from '../ui/controls';
import { useImportAnnouncer } from './importAnnouncer';
import { useImportSession } from './importSession';

/** The import chip in the local-first shell's banner (ADR-0463 BF-0463-02, flag
 * `cloud.progressive_import`): while an import keeps checking in the background, it says how far
 * it has got from any page, with a way back to the full progress on More > This device. It shows
 * only while an import is running or paused; hiding it lasts until the import's phase changes.
 * The count is not a live region: the shared announcer speaks milestones only, never each file. */
export function ImportChip({ onView, workspaceId }: { onView: () => void; workspaceId?: string }) {
  const live = useImportSession(workspaceId);
  useImportAnnouncer();
  const [hiddenIn, setHiddenIn] = useState<string | null>(null);
  useEffect(() => { setHiddenIn(null); }, [live.phase]);
  const paused = live.phase === 'paused';
  if ((live.phase !== 'running' && !paused) || hiddenIn === live.phase) return null;
  const words = paused
    ? 'Import paused: browser storage is full. Everything checked so far is in your library.'
    : `Checking your music: ${live.registered} of ${live.total ?? '…'} checked.`;
  return (
    <div className="cloud-import-chip">
      <Status kind={paused ? 'paused' : 'working'}>{words}</Status>
      <button type="button" className="quiet" onClick={onView}>Show import details</button>
      <button type="button" className="quiet" onClick={() => setHiddenIn(live.phase)}>Hide import details</button>
    </div>
  );
}
