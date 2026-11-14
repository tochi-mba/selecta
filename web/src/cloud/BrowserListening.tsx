import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { browserEngine } from '../engine/registry';
import { localCatalogue } from '../media/localCatalogue';
import { BrowserDeviceLibrary } from './lf-personal/BrowserWorkspace';
import type { Page } from './api';

/** Cloud Listen shares the persistent browser engine and the same locally-authorised
 * media index as Connect Music and Studio. It never opens hosted playback assets. */
export function BrowserListening({ workspaceId, go, openStudio }: {
  workspaceId: string;
  go: (page: Page) => void;
  openStudio: () => void;
}) {
  const engine = useMemo(() => browserEngine(workspaceId), [workspaceId]);
  const catalogue = useMemo(() => localCatalogue(workspaceId), [workspaceId]);
  const state = useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
  const [revision, setRevision] = useState(0);
  useEffect(() => catalogue.subscribe(() => setRevision((value) => value + 1)), [catalogue]);
  const recordings = useMemo(() => catalogue.recordings, [catalogue, revision]);
  const available = recordings.filter((recording) => recording.readiness === 'ready').length;
  return <section className="cloud-personal-listening" aria-label="Listen on this device">
    <div className="cloud-personal-listen-lead">
      <div>
        <p className="cloud-eyebrow">LISTEN · THIS DEVICE</p>
        <h2>What’s playing</h2>
        <p>Use the persistent player above to control this browser. Switching pages does not start another speaker.</p>
      </div>
      <div className="cloud-personal-quick-actions">
        <button className="primary" type="button" onClick={openStudio}>Open Studio</button>
        <button type="button" onClick={() => go('uploads')}>Connect music</button>
      </div>
    </div>
    <div className="cloud-personal-facts">
      <div><span>Now playing</span><strong>{state.title ?? 'Nothing loaded'}</strong>
        <small>{state.tracks > 0 ? `${state.index + 1} of ${state.tracks} in the local queue` : 'Choose a verified recording below'}</small></div>
      <div><span>Player state</span><strong>{state.pending ?? state.phase}</strong>
        <small>{state.ownership === 'none' ? 'No active speaker owned here' : 'This browser owns the local session'}</small></div>
      <div><span>Music available here</span><strong>{available} ready</strong>
        <small>{recordings.length - available} need verification or permission</small></div>
      <div><span>Physical output</span><strong>{state.soundCheck === 'user_confirmed' ? 'Confirmed by operator' : 'Not verified'}</strong>
        <small>Bluetooth and speaker changes require a new sound check</small></div>
    </div>
    {state.error && <p className="cloud-feedback error" role="alert">{state.error}</p>}
    <BrowserDeviceLibrary workspaceId={workspaceId} go={go} />
  </section>;
}
