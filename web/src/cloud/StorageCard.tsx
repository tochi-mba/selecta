import { useEffect, useState } from 'react';
import { useFlags } from '../flags';
import { storageSpace, type StorageSpace } from '../media';
import { Skeleton } from '../ui/controls';
import { InstallOffer } from './InstallOffer';
import { readPersistState, requestPersist, subscribePersist, type PersistState } from './persistence';

/** The words for each persistence answer. Exported for the tests. Only `granted` says the browser
 * keeps anything; every other state keeps the may-clear wording and says why. */
export const PERSIST_COPY: Record<PersistState, string> = {
  granted: "This browser keeps SelectaDJ's details on this device; it will not clear them to make room.",
  not_granted: 'The browser may clear them if the device runs short of space. Installing SelectaDJ, or pressing the button below, asks the browser to keep them; the browser decides.',
  refused: 'The browser may clear them if the device runs short of space. It decided not to keep them for now; browsers usually agree once SelectaDJ is installed or used often.',
  unsupported: 'The browser may clear them if the device runs short of space.',
};

export const MUSIC_NEVER_STORED = 'Your music files are never in browser storage, so clearing it never touches them.';

const megabytes = (bytes?: number) => (bytes === undefined ? '?' : bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/** More > This device: the browser storage SelectaDJ uses and whether the browser keeps it.
 * The keep-safe button and install offer sit behind `cloud.local_media` and reflow away when it
 * is off. `degraded` says the connected-files list is not being kept. */
export function StorageCard({ degraded }: { degraded: boolean }) {
  const on = useFlags();
  const offers = on('cloud.local_media');
  const [space, setSpace] = useState<StorageSpace | null>(null);
  const [persist, setPersist] = useState<PersistState | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    let live = true;
    void storageSpace().then((found) => { if (live) setSpace(found); });
    void readPersistState().then((found) => { if (live) setPersist(found); });
    const stop = subscribePersist((answer) => { if (live) setPersist(answer); });
    return () => { live = false; stop(); };
  }, []);
  const keep = () => {
    setAsking(true);
    void requestPersist().then(setPersist).finally(() => setAsking(false));
  };
  // Without the persistence answer, fall back to what the estimate said, never to a promise.
  const state: PersistState = persist ?? (space?.persisted ? 'granted' : 'unsupported');
  return (
    <section className="panel stack" aria-labelledby="this-device-storage">
      <h2 id="this-device-storage">Browser storage</h2>
      {space === null && <Skeleton lines={1} label="Checking this browser’s storage" />}
      {space && !space.supported && <p>{space.reason}</p>}
      {space?.supported && <p data-persist={state}>SelectaDJ keeps a few details in this browser, such as which of your files are which songs. {`SelectaDJ is using ${megabytes(space.usage)} of the ${megabytes(space.quota)} this browser allows.`} {PERSIST_COPY[state]} {MUSIC_NEVER_STORED}</p>}
      {offers && (state === 'not_granted' || state === 'refused') && (
        <div className="cloud-actions">
          <button type="button" onClick={keep} aria-busy={asking || undefined}>Keep this device's details safe</button>
        </div>
      )}
      {offers && <InstallOffer />}
      {degraded && <p role="note">This browser is not keeping SelectaDJ’s list of connected files, so you will need to connect them again next visit.</p>}
    </section>
  );
}
