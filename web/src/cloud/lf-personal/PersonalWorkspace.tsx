import { FormEvent, useState } from 'react';
import type { Account, Api, Page } from '../api';
import { bytes } from '../api';
import {
  claimSpeaker, ENGINE_INSTALL_GUIDE, LOCAL_ENGINE_URL, MEDIA_EXPLANATIONS, PersonalDevice,
  PersonalSnapshot, requestLocalScan, recentCheck, verificationWords,
} from './contract';
import { usePersonalRead, usePersonalSelection } from './state';
import { FolderWatches } from './FolderWatches';
import './personal.css';

type Props = { api: Api; workspaceId: string; go: (page: Page) => void; revision?: number };
const NO_DEVICES: PersonalDevice[] = [];

function DeviceChooser({ devices, value, controllerOnly, onChoose }: {
  devices: PersonalDevice[]; value: string; controllerOnly: boolean; onChoose: (id: string) => void;
}) {
  return <label className="lf-field">Selected device
    <select aria-label="Selected music device" value={controllerOnly ? '__controller_only__' : value} onChange={(event) => onChoose(event.target.value)}>
      <option value="">Choose a device</option>
      {devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.role === 'controller' ? ' (controller only)' : ''}</option>)}
      <option value="__controller_only__">This browser — controller only</option>
    </select>
  </label>;
}

function StatusLine({ device, now = Date.now(), readFresh = true }: { device: PersonalDevice | null; now?: number; readFresh?: boolean }) {
  if (!device) return <p className="lf-state" role="status">No local speaker selected. This browser cannot play music from another computer.</p>;
  const current = recentCheck(device.lastVerifiedAt, now);
  const canPlay = readFresh && device.role === 'engine' && device.engine === 'ready' && device.connectivity === 'online' && current && device.output === 'verified';
  const reason = !readFresh ? 'Cloud status is unavailable; last device report is unconfirmed' : device.role !== 'engine' ? 'Controller only — no audio executor'
    : !current ? 'Device check is stale or unavailable'
    : device.connectivity !== 'online' ? 'Device connection is not confirmed'
    : device.engine !== 'ready' ? `Engine ${device.engine.replaceAll('_', ' ')}`
    : device.output !== 'verified' ? device.output === 'silent' ? 'Output reported silent — check the speaker' : 'Real speaker output is not verified'
    : 'Local engine and speaker output verified recently';
  return <p className="lf-state" role="status" data-ready={canPlay ? 'yes' : 'no'}>{canPlay ? 'Recently verified on this device' : 'Not verified ready'} · {reason}</p>;
}

function ReadFeedback({ read }: { read: ReturnType<typeof usePersonalRead> }) {
  return <div className="lf-read" aria-live="polite">
    {read.phase === 'loading' && <p role="status">Checking device availability…</p>}
    {read.phase !== 'ready' && read.phase !== 'loading' && <div role={read.phase === 'error' ? 'alert' : 'status'}><p>{read.message}</p>{read.snapshot && <p>Previously loaded device information is shown below and may be out of date.</p>}</div>}
    {read.phase !== 'loading' && <button type="button" onClick={read.refresh}>Check devices again</button>}
  </div>;
}

function LocalEngineLink({ children = 'Open the local engine' }: { children?: string }) {
  return <a href={LOCAL_ENGINE_URL} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function SetupJourney({ api, workspaceId, refresh, devices, onController }: {
  api: Api; workspaceId: string; refresh: () => void; devices: PersonalDevice[]; onController: () => void;
}) {
  const [mode, setMode] = useState<'computer' | 'pair' | 'controller'>('computer');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      await claimSpeaker(api, workspaceId, code);
      setCode('');
      setMessage('Pairing request sent. Refresh the devices list and verify the speaker before using it.');
      refresh();
    } catch {
      setMessage('Pairing could not be confirmed. Check the code, speaker connection and availability of device pairing, then try again.');
    } finally { setBusy(false); }
  };
  return <section className="lf-panel" aria-labelledby="lf-setup-title">
    <h2 id="lf-setup-title">Set up your music</h2>
    <p>Your recordings remain on the computer or authorised music drive. This browser does not upload originals.</p>
    <fieldset className="lf-choices"><legend>How do you want to use Selecta?</legend>
      <label><input type="radio" name="lf-setup-mode" checked={mode === 'computer'} onChange={() => { setMode('computer'); setMessage(''); }} /> Use this device</label>
      <label><input type="radio" name="lf-setup-mode" checked={mode === 'pair'} onChange={() => { setMode('pair'); setMessage(''); }} /> Pair an existing speaker</label>
      <label><input type="radio" name="lf-setup-mode" checked={mode === 'controller'} onChange={() => { setMode('controller'); setMessage(''); onController(); }} /> Controller only</label>
    </fieldset>
    {mode === 'computer' && <div className="lf-next">
      <h3>Prepare this device</h3>
      <ol>
        <li><a href={ENGINE_INSTALL_GUIDE} target="_blank" rel="noopener noreferrer">Read local engine installation guidance</a> (Windows-first; other platforms may differ)</li>
        <li><LocalEngineLink>Open the engine on this device</LocalEngineLink> and grant access to your music folders there</li>
        <li>Scan the library locally; wait for supported files to finish indexing and analysis</li>
        <li>Test a real speaker or headphones in the engine; an online status alone does not confirm sound</li>
        <li>Return here and check this device’s verified status</li>
      </ol>
      <p className="lf-muted">The engine link opens on the device running this browser, never on a remote speaker.</p>
    </div>}
    {mode === 'pair' && <form className="lf-next" onSubmit={(event) => void submit(event)}>
      <h3>Pair a speaker already running Selecta</h3>
      <p>Generate a short-lived pairing code on that speaker. Pairing shares control, not its music files.</p>
      <label className="lf-field">Speaker pairing code
        <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" maxLength={24} pattern="[A-Za-z0-9-]{6,24}" required />
      </label>
      <button type="submit" disabled={busy || !code.trim()}>{busy ? 'Requesting pairing…' : 'Pair speaker'}</button>
      <p className="lf-muted">Pairing requires a compatible local-first service. An accepted request is not proof of audible playback.</p>
    </form>}
    {mode === 'controller' && <div className="lf-next">
      <h3>Use this browser as a controller</h3>
      <p>You can browse synced recipes and control a paired speaker, subject to device availability. This browser cannot play the other device’s files or render audio.</p>
      <button type="button" onClick={onController}>Use controller-only mode</button>
    </div>}
    {message && <p role="status" className="lf-feedback">{message}</p>}
    {devices.length === 0 && <p className="lf-muted">No registered speakers have been reported yet; this does not mean your music has been deleted.</p>}
  </section>;
}

function DeviceOverview({ snapshot, selected, controllerOnly, now, readFresh }: {
  snapshot: PersonalSnapshot; selected: PersonalDevice | null; controllerOnly: boolean; now: number; readFresh: boolean;
}) {
  const storage = snapshot.storage.find((s) => s.deviceId === selected?.id);
  const owner = snapshot.playback;
  const ownerDevice = snapshot.devices.find((device) => device.id === owner?.deviceId);
  return <div className="lf-grid">
    <section className="lf-panel" aria-label="Selected device readiness">
      <h2>Speaker readiness</h2>
      <p>{controllerOnly ? 'Controller-only browser' : selected?.name ?? 'No speaker selected'}</p>
      <StatusLine device={controllerOnly ? null : selected} now={now} readFresh={readFresh} />
      {selected && <p className="lf-muted">{verificationWords(selected.lastVerifiedAt, now)}</p>}
      {selected && <p>Music verified: {selected.checkedTracks === null || selected.totalTracks === null ? 'Not reported' : `${selected.checkedTracks} of ${selected.totalTracks}`}</p>}
      <p>Output: {selected?.output === 'verified' ? 'Recently verified locally' : selected?.output === 'silent' ? 'Reported silent' : 'Not confirmed'}</p>
    </section>
    <section className="lf-panel" aria-label="Actual playback owner">
      <h2>Current speaker</h2>
      {owner ? <><p><strong>{ownerDevice?.name ?? 'Registered speaker'}</strong> · {owner.status}</p><p>Output: {owner.output}</p></> : <p>No current playback owner reported. This does not confirm that an offline speaker is silent.</p>}
      {owner && owner.deviceId !== selected?.id && <p className="lf-muted">Another device owns playback. This browser is not streaming its audio.</p>}
    </section>
    <section className="lf-panel" aria-label="Local storage">
      <h2>Disk and cache</h2>
      {storage ? <><p>Local disk used: {storage.usedBytes === null ? 'Unknown' : bytes(storage.usedBytes)}</p><p>Free disk: {storage.freeBytes === null ? 'Unknown' : bytes(storage.freeBytes)}</p><p>Evictable cache: {storage.cacheBytes === null ? 'Unknown' : bytes(storage.cacheBytes)}</p></> : <p>No local hardware storage report for this device.</p>}
      <p className="lf-muted">These are device diagnostics, not a paid cloud music allowance.</p>
    </section>
  </div>;
}

function RecipeRecent({ snapshot, selected, now, go }: { snapshot: PersonalSnapshot; selected: PersonalDevice | null; now: number; go: (page: Page) => void }) {
  return <section className="lf-panel" aria-labelledby="lf-recent">
    <h2 id="lf-recent">Recent saved recipes</h2>
    {snapshot.recentRecipes.length === 0
      ? <p>No recent recipes were reported. You can still use the local Studio without uploading audio.</p>
      : <ul className="lf-items">{snapshot.recentRecipes.map((recipe) => {
        const onDevice = recipe.deviceId === selected?.id;
        const fresh = onDevice && recentCheck(recipe.lastVerifiedAt, now);
        return <li key={`${recipe.id}:${recipe.revision}`}>
          <strong>{recipe.title}</strong>
          <span>Revision {recipe.revision} · {onDevice ? 'Selected device' : 'Different or unknown device'}</span>
          <span>{recipe.verified === null || recipe.total === null ? 'Availability unknown' : `${recipe.verified} of ${recipe.total} tracks verified`}</span>
          <span>{fresh ? MEDIA_EXPLANATIONS[recipe.status] : 'Availability is stale or has not been checked here'}</span>
          <small>{verificationWords(recipe.lastVerifiedAt, now)}</small>
        </li>;
      })}</ul>}
    <button type="button" onClick={() => go('listen')}>Open mix workspace</button>
    <p className="lf-muted">Saved recipes are editable even when this speaker cannot play every recording.</p>
  </section>;
}

export function DeviceHome({ account, api, go, revision = 0 }: Props & { account: Account }) {
  const read = usePersonalRead(api, account.workspace.id, revision);
  const devices = read.snapshot?.devices ?? NO_DEVICES;
  const selection = usePersonalSelection(account.workspace.id, devices);
  const [now, setNow] = useState(() => Date.now());
  const checkAgain = () => { setNow(Date.now()); read.refresh(); };
  return <div className="lf-personal">
    <div className="lf-hero"><p className="cloud-eyebrow">YOUR LOCAL MUSIC WORKSPACE</p><h2>Your music stays on your devices.</h2><p>Sync recipes and control authorised speakers without hosting your recordings or derived audio.</p>
      <div className="lf-actions"><button className="primary" onClick={() => go('uploads')}>Connect local music</button><button onClick={() => go('library')}>Browse device library</button></div>
    </div>
    <ReadFeedback read={{ ...read, refresh: checkAgain }} />
    {read.phase === 'loading' && <div className="lf-grid" aria-hidden="true"><div className="lf-panel lf-placeholder" /><div className="lf-panel lf-placeholder" /><div className="lf-panel lf-placeholder" /></div>}
    {read.snapshot && <>
      <DeviceChooser devices={devices} value={selection.selected?.id ?? ''} controllerOnly={selection.controllerOnly} onChoose={selection.choose} />
      <DeviceOverview snapshot={read.snapshot} selected={selection.selected} controllerOnly={selection.controllerOnly} now={now} readFresh={read.phase === 'ready'} />
      <RecipeRecent snapshot={read.snapshot} selected={selection.selected} now={now} go={go} />
    </>}
    {(!read.snapshot || devices.length === 0) && <SetupJourney api={api} workspaceId={account.workspace.id} refresh={checkAgain} devices={devices} onController={selection.chooseControllerOnly} />}
    <div className="lf-actions"><button onClick={() => go('settings')}>Devices and settings</button><button onClick={() => go('listen')}>Explore and Studio</button></div>
  </div>;
}

export function ConnectLocalMusic({ api, workspaceId, go }: Props) {
  const read = usePersonalRead(api, workspaceId);
  const devices = read.snapshot?.devices ?? NO_DEVICES;
  const selection = usePersonalSelection(workspaceId, devices);
  return <div className="lf-personal">
    <div className="lf-hero"><p className="cloud-eyebrow">DEVICE-LOCAL SOURCE SETUP</p><h2>Connect local music</h2><p>Choose a local folder or drive in the installed engine. Selecta Cloud never receives your audio, folder paths or raw fingerprints.</p></div>
    <ReadFeedback read={read} />
    <FolderWatches />
    <SetupJourney api={api} workspaceId={workspaceId} refresh={read.refresh} devices={devices} onController={selection.chooseControllerOnly} />
    {selection.selected && <p className="lf-state">Current selection: {selection.selected.name}. <button onClick={() => go('library')}>View source health</button></p>}
    <p className="lf-muted">Older /upload and /uploads bookmarks lead here in local-first workspaces. Historical uploads are not deleted by this UI change.</p>
  </div>;
}

const SOURCE_WORDS: Record<string, string> = {
  ready: 'Indexed locally', scanning: 'Local scan in progress', source_disconnected: 'Drive disconnected — reconnect and rescan',
  permission_required: 'Folder permission required — reauthorise in the local engine',
  needs_analysis: 'Analysis is incomplete — prepare on the local engine',
  unsupported: 'Unsupported media present — review locally', unknown: 'Source has not been verified',
};

export function DeviceLibrary({ api, workspaceId, go, revision = 0 }: Props) {
  const read = usePersonalRead(api, workspaceId, revision);
  const devices = read.snapshot?.devices ?? NO_DEVICES;
  const selection = usePersonalSelection(workspaceId, devices);
  const selected = selection.selected;
  const sources = read.snapshot?.sources.filter((source) => source.deviceId === selected?.id) ?? [];
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const scan = async () => {
    if (!selected) return;
    setScanBusy(true); setScanMessage('');
    try {
      await requestLocalScan(api, workspaceId, selected.id);
      setScanMessage('Scan requested. Files will be verified by the local engine; refresh to check actual progress.');
      read.refresh();
    } catch {
      setScanMessage('The scan could not be requested. Open the local engine to scan this source directly.');
    } finally { setScanBusy(false); }
  };
  return <section className="lf-personal" aria-label="Per-device music library">
    <div className="lf-hero"><p className="cloud-eyebrow">DEVICE-LOCAL LIBRARY</p><h2>Music sources on each device</h2><p>This view shows approved metadata reported by your devices, not the contents of cloud object storage.</p></div>
    <ReadFeedback read={read} />
    <FolderWatches compact />
    {read.snapshot && <>
      <DeviceChooser devices={devices} value={selected?.id ?? ''} controllerOnly={selection.controllerOnly} onChoose={selection.choose} />
      <StatusLine device={selection.controllerOnly ? null : selected} readFresh={read.phase === 'ready'} />
      {selected && <p className="lf-muted">{verificationWords(selected.lastVerifiedAt)}</p>}
      <div className="lf-actions">
        <button className="primary" onClick={() => go('uploads')}>Add local source</button>
        <button onClick={() => void scan()} disabled={scanBusy || !selected || selected.role !== 'engine' || selected.connectivity !== 'online'}>{scanBusy ? 'Requesting scan…' : 'Request a local rescan'}</button>
        <LocalEngineLink>Open local source manager</LocalEngineLink>
      </div>
      {scanMessage && <p className="lf-feedback" role="status">{scanMessage}</p>}
      {!selected ? <p>Choose a registered engine or pair one to inspect its source health. Controller-only browsers have no music library of their own.</p>
        : sources.length === 0 ? <p>No local source has been reported for this device. A disconnected or offline engine may still have music on disk.</p>
        : <ul className="lf-source-grid">{sources.map((source) => {
          const stale = !recentCheck(source.lastScannedAt);
          return <li className="lf-panel" key={source.id}>
            <h3>{source.label}</h3>
            <p className="lf-state">{SOURCE_WORDS[source.state]}{stale ? ' · Scan information stale' : ''}</p>
            <p>{source.tracks === null ? 'Track count not reported' : `${source.tracks} indexed tracks`}</p>
            <p>Analysis: {source.analysed === null || source.tracks === null ? 'Not reported' : `${source.analysed} of ${source.tracks}`}</p>
            {source.unsupported !== null && source.unsupported > 0 && <p>{source.unsupported} unsupported files; review format in the local engine.</p>}
            <small>{verificationWords(source.lastScannedAt)}</small>
          </li>;
        })}</ul>}
    </>}
    {!read.snapshot && <p>Source inventory is unknown while device management is unavailable; your local recordings have not been inspected or changed.</p>}
  </section>;
}
