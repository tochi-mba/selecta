import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { clearEverythingOnDevice, forgetWorkspaceOnDevice } from './deviceData';

// This browser's copy of SelectaDJ data (ADR-0469, flag `cloud.local_media`). Signing out keeps
// it so coming back is instant; these two actions let it go on purpose. Neither touches the
// music files themselves or anything stored in the account.

type Asking = 'forget' | 'everything' | null;

export function DeviceDataCard({ workspaceId, onCleared }: { workspaceId: string; onCleared: () => void }) {
  const [asking, setAsking] = useState<Asking>(null);
  const [working, setWorking] = useState(false);
  // The safe answer takes focus when a question opens, Escape backs out, and focus returns to the
  // button that asked, as the leaving and deleting card does.
  const keep = useRef<HTMLButtonElement>(null);
  const forget = useRef<HTMLButtonElement>(null);
  const everything = useRef<HTMLButtonElement>(null);
  const last = useRef<Asking>(null);
  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (last.current) (last.current === 'forget' ? forget : everything).current?.focus();
    last.current = asking ?? last.current;
  }, [asking]);
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !working) { event.stopPropagation(); setAsking(null); } };
  const run = async (what: Exclude<Asking, null>) => {
    setWorking(true);
    try {
      if (what === 'forget') await forgetWorkspaceOnDevice(workspaceId);
      else await clearEverythingOnDevice([workspaceId]);
    } finally {
      setWorking(false);
      setAsking(null);
    }
    onCleared();
  };
  return (
    <section className="cloud-card" aria-labelledby="cloud-device-data-title">
      <p className="cloud-eyebrow">This browser</p>
      <h2 id="cloud-device-data-title">What SelectaDJ keeps here</h2>
      <p>This browser remembers which of your files are which songs, the folder you connected, and work it has already done on your music, so signing back in is quick. Your music files and your account are not affected by either choice below.</p>
      <div className="cloud-danger-row">
        <div><h3>Forget this account here</h3><p>Removes this account's song list, connected folder and unfinished import from this browser. You would connect your music again next time.</p></div>
        <button ref={forget} className="cloud-quiet" disabled={working} aria-expanded={asking === 'forget'} onClick={() => setAsking('forget')}>Forget this account here…</button>
      </div>
      {asking === 'forget' && (
        <div className="cloud-confirm" role="group" aria-label="Confirm forgetting this account in this browser" onKeyDown={escape}>
          <p>Forget this account in this browser? Your music files stay where they are. This can’t be undone, and the page reloads afterwards.</p>
          <div className="cloud-actions"><button ref={keep} disabled={working} onClick={() => setAsking(null)}>Keep it</button><button className="cloud-danger-action" disabled={working} aria-busy={working || undefined} onClick={() => void run('forget')}>{working ? 'Forgetting…' : 'Forget this account here'}</button></div>
        </div>
      )}
      <div className="cloud-danger-row">
        <div><h3>Clear everything in this browser</h3><p>Removes what SelectaDJ keeps here for every account that has signed in, including work already done on your music and your preferences on this browser.</p></div>
        <button ref={everything} className="cloud-quiet cloud-danger-text" disabled={working} aria-expanded={asking === 'everything'} onClick={() => setAsking('everything')}>Clear everything…</button>
      </div>
      {asking === 'everything' && (
        <div className="cloud-confirm" role="group" aria-label="Confirm clearing everything SelectaDJ keeps in this browser" onKeyDown={escape}>
          <p>Clear everything SelectaDJ keeps in this browser, for every account? Your music files and accounts stay as they are. This can’t be undone, and the page reloads afterwards.</p>
          <div className="cloud-actions"><button ref={keep} disabled={working} onClick={() => setAsking(null)}>Keep it</button><button className="cloud-danger-action" disabled={working} aria-busy={working || undefined} onClick={() => void run('everything')}>{working ? 'Clearing…' : 'Clear everything'}</button></div>
        </div>
      )}
    </section>
  );
}
