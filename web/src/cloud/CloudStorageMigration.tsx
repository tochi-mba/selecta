import { useEffect, useState } from 'react';
import type { MediaStore } from '../media/store';
import { Action } from '../ui/controls';
import { UploadChip, useUploadQueue } from './UploadChip';
import type { Request } from './uploadConsent';
import { useUploadToCloud } from './uploadEntry';

/** The Cloud account can copy files this browser already knows about, after the user approves. */
export function CloudStorageMigration({ workspaceId, request, openStore }: {
  workspaceId: string;
  request: Request;
  openStore: () => Promise<MediaStore>;
}) {
  const [hasSongs, setHasSongs] = useState(false);
  const queue = useUploadQueue(workspaceId);
  const upload = useUploadToCloud({ request, openStore, retainDeviceFiles: true });
  useEffect(() => {
    let active = true;
    void openStore().then((store) => store.all()).then(
      (songs) => { if (active) setHasSongs(songs.length > 0); },
      () => { if (active) setHasSongs(false); },
    );
    return () => { active = false; };
  }, [openStore]);

  if (!upload.available || (!hasSongs && queue.phase === 'idle')) return null;
  return (
    <section className="ui-card" aria-label="Move connected music to Cloud">
      <h2 className="section-title">Move your connected music to Cloud</h2>
      {hasSongs && (queue.phase === 'idle' || queue.phase === 'finished') && (
        <>
          <p>Copy the songs already connected on this device. Your original files stay where they are.</p>
          <Action run={() => upload.open()} disabled={queue.workspaceId !== workspaceId} working="Checking songs…">Review songs to upload</Action>
        </>
      )}
      {upload.problem && <p className="hint" role="status">{upload.problem}</p>}
      <UploadChip workspaceId={workspaceId} />
      {upload.sheet}
    </section>
  );
}
