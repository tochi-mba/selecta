// The cloud harness gallery (`/harness?page=gallery`): the Cloud, Rooms and devices patterns on the
// same sheets the Cloud site loads, beside the shared ui primitives they are built from. It needs
// no account and no server; nothing here reads or writes data. Built only with SELECTA_CLOUD_E2E=1,
// like the rest of the harness. The local gallery is ui/ControlGallery.tsx (Workspace, Diagnostics).
import { useState } from 'react';
import '../styles/tokens.css';
import '../styles/boot.css';
import '../style.css';
import '../styles/shell.css';
import '../styles/polish.css';
import '../styles/foundation.css';
import '../styles/icons.css';
import '../styles/depth.css';
import '../styles/typography.css';
import '../cloud/cloud.css';
import '../rooms/rooms.css';
import '../devices/devices.css';
import { AccountProblemNote, NotFound, SuspendedPanel } from '../cloud/CloudStates';
import { CannotPlayHere, EmptyState, NotOnThisAccount } from '../cloud/LocalFirstEmpty';
import { NoHostedStorage } from '../cloud/Meters';
import { BrandMark } from '../ui/BrandMark';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Action, LiveRegion, Problem, Skeleton, Status } from '../ui/controls';
import { GALLERY_KINDS } from '../ui/gallery/specimens';
import { Icon } from '../ui/Icon';
import { Meter } from '../ui/Meter';
import { VisuallyHidden } from '../ui/primitives';
import { showToast, Toaster } from '../ui/toasts';

const nowhere = () => {};

export function CloudGallery() {
  const [confirm, setConfirm] = useState<'forget' | 'code' | null>(null);
  const [said, setSaid] = useState('');
  return (
    <main className="cloud-main cloud-gallery" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-5)', padding: 'var(--space-4)', maxWidth: 1100, marginInline: 'auto' }}>
      <header className="stack">
        <p className="cloud-eyebrow cloud-caps">Test harness</p>
        <h1><BrandMark /> SelectaDJ Cloud patterns</h1>
        <p className="cloud-hint">Invented content on the Cloud site’s own sheets. Inspect it in both themes, at 320px, with reduced motion and by keyboard.</p>
      </header>

      <section className="cloud-card stack" aria-labelledby="g-status"><h2 id="g-status">Statuses, actions and meters</h2>
        <div className="row wrap">{GALLERY_KINDS.map((kind) => <Status key={kind} kind={kind} />)}</div>
        <div className="cloud-actions">
          <button className="primary">Primary action</button>
          <button>Secondary action</button>
          <Action working="Checking…" run={() => new Promise<void>((resolve) => window.setTimeout(() => { setSaid('Checked for this demonstration.'); resolve(); }, 800))}>Check now</Action>
          <button className="destructive" onClick={() => setConfirm('forget')}>Sign out a device</button>
          <button onClick={() => setConfirm('code')}>Make a new code</button>
          <button onClick={() => showToast('Removed. You can undo this for a few seconds.', { undo: () => setSaid('Put back.') })}>Show an undo toast</button>
        </div>
        {said && <p role="status">{said}</p>}
        <div className="cloud-meters stack">
          <Meter label="Files checked" value={705} max={2898} valueText="705 of 2,898 files" />
          <Meter label="Files checked, total unknown" valueText="Still counting" />
          <Meter label="Hosted storage" kind="meter" value={88} warnAt={0.8} dangerAt={0.95} valueText="88 percent" detail="Resets on the 1st." />
        </div>
        <NoHostedStorage />
      </section>

      <section className="cloud-card stack" aria-labelledby="g-onboarding"><h2 id="g-onboarding">Onboarding and connecting music</h2>
        <ol className="cloud-spine-steps" aria-label="Setting up">
          <li data-outcome="done"><Icon name="check" size="compact" /> Choose music</li>
          <li aria-current="step"><Icon name="half" size="compact" /> Check the sound</li>
          <li data-outcome="unverified"><Icon name="warning" size="compact" /> Name this device</li>
        </ol>
        <div className="cloud-actions">
          <label className="cloud-spine-pick primary" htmlFor="g-files"><Icon name="music" size="toolbar" /> Choose music files<input id="g-files" type="file" multiple accept="audio/*" onChange={nowhere} /></label>
          <button type="button"><Icon name="folder" size="toolbar" /> Choose a folder</button>
        </div>
        <p className="cloud-hint">A picker hidden only visually stays in the tab order; its label shows the focus ring.</p>
        <p className="cloud-inline-error" role="alert">SelectaDJ could not open that folder. Try choosing your music files instead.</p>
      </section>

      <section className="stack" aria-labelledby="g-states"><h2 id="g-states">Honest states</h2>
        <NotFound path="/an-old-link" go={nowhere} />
        <AccountProblemNote kind="offline" onRetry={nowhere} />
        <SuspendedPanel go={nowhere} />
        <EmptyState title="Nothing here yet" actions={<button>Connect music</button>}><p>Specimen empty state on the local-first shell’s pattern.</p></EmptyState>
        <CannotPlayHere reason="This browser can’t decode these files." />
        <NotOnThisAccount />
        <Problem retry={() => new Promise((resolve) => window.setTimeout(resolve, 400))}>Example: the library could not be loaded.</Problem>
        <Skeleton variant="rows" lines={3} label="Library rows loading example" />
        <Skeleton variant="cards" lines={2} label="Cards loading example" />
      </section>

      <section className="cloud-card stack" aria-labelledby="g-rooms"><h2 id="g-rooms">Rooms and devices</h2>
        <div className="room-panel stack">
          <div className="room-head"><h3>Your room</h3><Status kind="ready">Open for requests</Status></div>
          <p>Room code <b className="room-code">K7Q2</b><VisuallyHidden>, spelled K 7 Q 2</VisuallyHidden></p>
          <ul className="room-list">
            <li className="room-row"><span>A requested song with a long title from a guest at the back</span><span className="room-said">from Sam</span><button>Play next</button></li>
            <li className="room-row"><span>Another request</span><span className="room-said">2 votes</span><button>Play next</button></li>
          </ul>
          <p className="room-error" role="alert">That code was replaced. The old QR code stops working the moment a new one exists.</p>
        </div>
        <div className="devices-panel stack">
          <h3>Your devices</h3>
          <ul className="devices-list">
            <li><span className="devices-name">Living room speaker</span><span className="devices-seen">Seen just now</span><span className="devices-actions"><button>Play here</button><button className="destructive" onClick={() => setConfirm('forget')}>Sign out this device</button></span></li>
          </ul>
          <div className="playing-bar">
            <p className="playing-bar-song"><b>Specimen song</b> by Example artist</p>
            <p className="playing-bar-where">Playing on Living room speaker</p>
            <div className="playing-bar-controls"><button aria-label="Pause" title="Pause"><Icon name="pause" /></button><button aria-label="Next song" title="Next song"><Icon name="next" /></button></div>
            <p className="playing-bar-error" role="alert">That speaker went offline. Your presses wait until it is back.</p>
          </div>
        </div>
      </section>

      {confirm === 'forget' && (
        <ConfirmDialog title="Sign out Living room speaker?" body="That device is signed out of your account. It can sign in again any time." destructive confirmLabel="Sign out this device" onConfirm={() => setSaid('Signed out, for this demonstration.')} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'code' && (
        <ConfirmDialog title="Make a new code?" body="The old QR code stops working the moment the new one exists." confirmLabel="Make a new code" onConfirm={() => setSaid('A new code, for this demonstration.')} onClose={() => setConfirm(null)} />
      )}
      <Toaster />
      <LiveRegion />
    </main>
  );
}
