import { useEffect, useState } from 'react';
import { useFlags } from '../flags';
import { storageSpace, type StorageSpace } from '../media';
import { Skeleton, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Meter } from '../ui/Meter';
import { InstallOffer } from './InstallOffer';
import { readPersistState, requestPersist, subscribePersist, type PersistState } from './persistence';
import './libraryWorkspace.css';

/** The words for each persistence answer. Exported for the tests. Only `granted` says the browser
 * keeps anything; every other state keeps the may-clear wording and says why. */
export const PERSIST_COPY: Record<PersistState, string> = {
  granted: 'This browser keeps SelectaDJ’s details on this device; it will not clear them to make room.',
  not_granted: 'The browser may clear them if the device runs short of space. Ask it to keep them, or install SelectaDJ; the browser decides.',
  refused: 'The browser may clear them if the device runs short of space. It decided not to keep them for now; browsers usually agree once SelectaDJ is installed or used often.',
  unsupported: 'The browser may clear them if the device runs short of space.',
};

export const MUSIC_NEVER_STORED = 'Your music files are never in browser storage, so clearing it never touches them.';

const megabytes = (bytes?: number) => (bytes === undefined ? '?' : bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/** Browser storage: how much SelectaDJ uses of what the browser allows, drawn as a meter, whether
 * the browser has agreed to keep it, and the one thing to do about it. The keep-safe button and
 * install offer sit behind `cloud.local_media` and reflow away when it is off. `degraded` says the
 * connected-files list is not being kept. */
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
  const canAsk = offers && (state === 'not_granted' || state === 'refused');
  return (
    <section className="ui-card lw-storage" aria-labelledby="this-device-storage">
      <div className="ui-card-head">
        <div>
          <h2 className="section-title" id="this-device-storage">Browser storage</h2>
          <p className="section-lead">A few details, such as which of your files are which songs. {MUSIC_NEVER_STORED}</p>
        </div>
        {space?.supported && <Status kind={state === 'granted' ? 'ready' : 'warning'}>{state === 'granted' ? 'Kept safe on this device' : 'May be cleared'}</Status>}
      </div>
      {space === null && <Skeleton lines={1} label="Checking this browser’s storage" />}
      {space && !space.supported && <p>{space.reason}</p>}
      {space?.supported && (
        <Meter kind="meter" label="Used by SelectaDJ" value={space.usage ?? 0} max={Math.max(space.quota ?? 0, 1)}
          valueText={`${megabytes(space.usage)} of ${megabytes(space.quota)}`} warnAt={0.8} dangerAt={0.95} />
      )}
      {space?.supported && <p className="lw-storage-state" data-persist={state}>{PERSIST_COPY[state]}</p>}
      {canAsk && (
        <div className="lw-actions-row">
          <button type="button" className="primary" onClick={keep} aria-busy={asking || undefined}><Icon name="lock" size="toolbar" />{asking ? 'Asking the browser…' : 'Keep these details safe'}</button>
        </div>
      )}
      {offers && <InstallOffer />}
      {degraded && <p className="banner" data-tone="danger" role="note"><Icon name="warning" size="toolbar" /><span>This browser is not keeping SelectaDJ’s list of connected files, so you will need to connect them again next visit.</span></p>}
    </section>
  );
}
