import { ReactNode, useEffect, useState } from 'react';
import type { MediaStore } from '../media';
import { StorageCard } from './StorageCard';

// Small pages of the local-first shell (LocalFirstShell.tsx), kept apart so the shell stays
// readable: More > This device, and the two "couldn't open" states.

/** More > This device: the music connected here and the storage it uses (workspace extras). */
export function ThisDevice({ openStore, children }: { openStore: () => Promise<MediaStore>; children: ReactNode }) {
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    let live = true;
    void openStore().then((opened) => { if (live) setDegraded(opened.degraded); }).catch(() => undefined);
    return () => { live = false; };
  }, [openStore]);
  return (
    <main className="page" id="main">
      <h1 className="display small">This device</h1>
      <StorageCard degraded={degraded} />
      {children}
    </main>
  );
}

/** The library could not be opened (cloud.offline_shell): plain words and one way on. */
export function StatusProblem({ words, onRetry }: { words: string; onRetry: () => void }) {
  return (
    <div className="stack" role="alert">
      <p>SelectaDJ couldn’t open your library. {words}</p>
      <div><button type="button" onClick={onRetry}>Try again</button></div>
    </div>
  );
}

/** The current mix could not be read (cloud.offline_shell): never shown as an empty mix. */
export function MixProblem({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="page" id="main">
      <div className="stack" role="alert">
        <p>SelectaDJ couldn’t load your mix. It is still saved; try again, or wait for the connection to come back.</p>
        <div><button type="button" onClick={onRetry}>Try again</button></div>
      </div>
    </main>
  );
}
