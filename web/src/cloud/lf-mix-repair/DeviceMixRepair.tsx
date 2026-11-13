import { useId, useRef, useState } from 'react';
import type { DeviceTarget, DeviceMixReadiness, TrackReference, VerifiedTrack, RepairVariation } from './readiness';
import { canAcceptCandidate, countReadiness, createTemporaryVariation, isStale, MEDIA_STATES } from './readiness';
import './repair.css';

export type LocalRepairRequest =
  | { kind: 'control'; deviceId: string }
  | { kind: 'locate'; deviceId: string; occurrenceId: string; file: File }
  | { kind: 'reconnect'; deviceId: string; occurrenceId: string }
  | { kind: 'review'; deviceId: string; occurrenceId: string; candidateId: string }
  | { kind: 'authorise'; deviceId: string; occurrenceId: string };

export type RepairResult = { accepted: boolean; detail: string };
export type RepairExecutor = (request: LocalRepairRequest) => Promise<RepairResult>;

export function ReadinessBadge({ readiness, total }: { readiness: DeviceMixReadiness | null; total: number }) {
  const counts = readiness ? countReadiness(readiness) : null;
  const ready = counts?.ready ?? 0;
  const stale = !counts || counts.stale;
  return (
    <span className="lf11-readiness" aria-label={stale
      ? `Availability unverified: 0 of ${total} recordings verified on this device`
      : `${ready} of ${total} recordings verified on this device`}>
      {stale ? `Unverified · ${total} recordings` : `${ready}/${total} verified`}
    </span>
  );
}

export function DeviceMixRepair({
  mixId, revision, tracks, devices, deviceId, onDeviceChange, readiness,
  onRepair, onApplyVariation, currentDraftChanged = false,
}: {
  mixId: string;
  revision: string;
  tracks: TrackReference[];
  devices: DeviceTarget[];
  deviceId: string;
  onDeviceChange: (id: string) => void;
  readiness: DeviceMixReadiness | null;
  onRepair?: RepairExecutor;
  onApplyVariation?: (variation: RepairVariation) => void;
  currentDraftChanged?: boolean;
}) {
  const selectId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [variation, setVariation] = useState<RepairVariation | null>(null);
  const device = devices.find(d => d.id === deviceId);
  const scoped = readiness?.deviceId === deviceId && readiness.mixId === mixId && readiness.revision === revision
    && readiness.tracks.length === tracks.length ? readiness : null;
  const stale = !scoped || isStale(scoped);
  const counts = scoped ? countReadiness(scoped) : null;
  const capability = counts?.capabilities;
  const live = !!device && !!scoped && !stale && device.connected === true;
  const selectedRows = tracks.map((track, at) => ({
    track, at, status: stale ? 'Unknown' : scoped?.tracks[at]?.state ?? 'Unknown',
    verified: scoped?.tracks[at],
  }));

  const run = async (request: LocalRepairRequest) => {
    if (!onRepair || !device || !live) {
      setNotice('No authorised local engine repair connection is available. Use Selecta on the device holding the recording.');
      return;
    }
    setWorking(true);
    setNotice('');
    try {
      const result = await onRepair(request);
      setNotice(result.detail || (result.accepted
        ? 'The local engine accepted the request. Verify the recording again before playback.'
        : 'The local engine refused the request.'));
    } catch {
      setNotice('The local engine could not complete the request. Saved recipe history was not changed.');
    } finally {
      setWorking(false);
    }
  };

  const makeVariation = () => {
    if (!scoped) return;
    const prepared = createTemporaryVariation(mixId, revision, tracks, scoped);
    if (!prepared) {
      setNotice('A temporary variation cannot be prepared until the local engine verifies usable recordings.');
      return;
    }
    setVariation(prepared);
    setNotice(`Temporary arrangement: ${prepared.orderedOccurrenceIds.length} recordings; ${prepared.skippedOccurrenceIds.length} omitted. No original revision has changed.`);
  };

  const chooseFile = async (file: File | undefined) => {
    const occurrenceId = locating;
    setLocating(null);
    if (!file || !occurrenceId || !deviceId) return;
    if (fileRef.current) fileRef.current.value = '';
    // The file object is passed only to the injected, explicitly device-local
    // adapter. It is never sent to Selecta Cloud or read by this component.
    await run({ kind: 'locate', deviceId, occurrenceId, file });
  };

  return (
    <section className="lf11-panel" aria-label="Device mix readiness and repair">
      <h3>Music on this device</h3>
      <label htmlFor={selectId}>Verify for device</label>
      <select id={selectId} value={deviceId} onChange={e => {
        onDeviceChange(e.target.value);
        setVariation(null);
        setNotice('');
      }}>
        <option value="">Select a local engine</option>
        {devices.map(d => <option key={d.id} value={d.id}>{d.name}{d.controllerOnly ? ' (controller only)' : ''}</option>)}
      </select>
      {!devices.length && <p>No verified local engine is paired. Arrangement editing is still available.</p>}
      {device?.controllerOnly && <p>Controller-only devices cannot play recordings stored elsewhere.</p>}
      <p role="status">
        {stale
          ? 'Unknown — local verification is missing, disconnected or older than two minutes. Cached information cannot enable playback.'
          : `${counts?.ready ?? 0}/${tracks.length} exact recordings verified on ${device?.name ?? 'the selected device'}.`}
      </p>
      <p className="lf11-muted">
        Last local verification: {scoped?.checkedAt ? new Date(scoped.checkedAt).toLocaleString() : 'never'}
        {stale ? ' (stale or untrusted)' : ''}
      </p>
      <div className="lf11-capabilities" aria-label="Creative capabilities">
        <span>Editable: Yes</span>
        <span>Renderable: {live && capability?.renderable ? 'Yes' : 'No'}</span>
        <span>Auditionable: {live && capability?.auditionable ? 'Yes' : 'No'}</span>
        <span>Playable: {live && capability?.playable && device?.outputVerified && !device.controllerOnly ? 'Yes' : 'No'}</span>
      </div>
      <p>{!live ? 'The arrangement remains editable without audio.'
        : capability?.reason ?? 'Audio status is unverified.'}</p>
      {counts && !stale && counts.unresolved > 0 && (
        <p>{counts.unresolved} unresolved of {counts.total}; missing and candidate recordings never count as ready.</p>
      )}
      {scoped && (
        <ul className="lf11-track-list" aria-label="Per-track local availability">
          {selectedRows.map(({ track, status, verified }) => {
            const unresolved = status !== 'Ready';
            return (
              <li key={track.occurrenceId}>
                <div>
                  <strong>{track.title}</strong>{track.artist ? ` — ${track.artist}` : ''}
                  <span className="lf11-state">{status}</span>
                  {verified?.reason && <p>{verified.reason}</p>}
                  {status === 'Candidate' && (
                    <p>{canAcceptCandidate(track, verified as VerifiedTrack)
                      ? 'Exact recorded identity and content policy verified. Review before choosing.'
                      : 'Not verified as the same recording and version; no automatic substitution.'}</p>
                  )}
                </div>
                {unresolved && <div className="lf11-actions">
                  <button disabled={!live || !onRepair || working} onClick={() => void run({
                    kind: 'reconnect', deviceId, occurrenceId: track.occurrenceId,
                  })}>Reconnect source</button>
                  <button disabled={!live || !onRepair || working} onClick={() => void run({
                    kind: 'authorise', deviceId, occurrenceId: track.occurrenceId,
                  })}>Authorise source</button>
                  <button disabled={!live || !onRepair || working} onClick={() => {
                    setLocating(track.occurrenceId);
                    fileRef.current?.click();
                  }}>Locate local recording</button>
                  {status === 'Candidate' && verified?.candidateId && <button
                    disabled={!live || !onRepair || working}
                    onClick={() => void run({ kind: 'review', deviceId, occurrenceId: track.occurrenceId,
                      candidateId: verified.candidateId! })}>
                    Review alternate version
                  </button>}
                </div>}
              </li>
            );
          })}
        </ul>
      )}
      <input type="file" accept="audio/*" className="lf11-hidden-file"
        aria-label="Local file for repair" ref={fileRef}
        onChange={event => { void chooseFile(event.target.files?.[0]); }} />
      <div className="lf11-actions">
        <button disabled={!device || !onRepair || working || !device.connected}
          onClick={() => void run({ kind: 'control', deviceId })}>Control a device with the music</button>
        <button disabled={!live || !scoped || !!device?.controllerOnly} onClick={makeVariation}>
          Create temporary playable variation
        </button>
      </div>
      {variation && (
        <section aria-label="Temporary variation" className="lf11-variation">
          <h4>Temporary arrangement (not yet playing)</h4>
          <p>{variation.orderedOccurrenceIds.length} verified tracks selected; {variation.skippedOccurrenceIds.length} skipped.
            Cues, transitions and previews must be rechecked on the local engine.</p>
          <button disabled={currentDraftChanged || !onApplyVariation}
            onClick={() => { onApplyVariation?.(variation); setVariation(null); }}>
            Copy to editable draft
          </button>
          {currentDraftChanged && <p>Finish or discard current draft changes before applying this variation.</p>}
        </section>
      )}
      {notice && <p role="status" className="lf11-notice">{notice}</p>}
      <p className="lf11-muted">No recording, path, audio preview or fingerprint is sent to cloud by this repair panel.
        A successful request is not proof of sound at the physical output. Saved revisions are immutable.</p>
      <details>
        <summary>Availability states</summary>
        <p>{MEDIA_STATES.join(' · ')}</p>
      </details>
    </section>
  );
}
