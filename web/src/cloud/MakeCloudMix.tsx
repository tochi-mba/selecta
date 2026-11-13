import { FormEvent, useCallback, useEffect, useState } from 'react';
import { DeviceMixRepair, ReadinessBadge } from './lf-mix-repair/DeviceMixRepair';
import { acceptReadiness, referencesOf, type DeviceMixReadiness, type DeviceTarget, type RepairVariation } from './lf-mix-repair/readiness';
import { CloudError, featureOn, type Account, type Api, type Asset } from './api';
import './makeCloudMix.css';

// Make and edit a mix from Cloud Library songs (ADR-0418, flag `cloud.mix_create`). Each save is
// a new immutable revision of the shared mix contract; an edit names the revision it was made
// from, so a stale edit is refused rather than overwriting someone else's change. Seams say what
// they really are: a plain crossfade until both songs have tempo and key facts. With the flag off
// this renders nothing and Cloud Listen is exactly as before.

export const MIX_CREATE_FLAG = 'cloud.mix_create';

type Facts = { bpm: number | null; camelot: string | null; energy: number | null };
export type MixSong = { source: string; id: string; title: string; artist: string | null; duration: number | null; facts: Facts; available?: boolean; occurrence_id?: string; explicit?: boolean | null; version?: string | null };
export type MixSeam = { into: number; method: string; bars: number; basis: string; intelligent: boolean; reason: string };
export type CloudMix = { mix_id: string; name: string; number: number; parent: string | null; revision: string; songs: MixSong[]; seams: MixSeam[]; intelligent_seams: number };
export type MixSummary = { mix_id: string; name: string; revision: string; number: number; songs: number; intelligent_seams: number; updated_at: number };
type History = { revision: string; number: number; name: string; songs: number }[];

function problem(error: unknown, fallback: string) {
  return error instanceof CloudError || error instanceof Error ? error.message : fallback;
}

function seamWords(seam: MixSeam) {
  if (!seam.intelligent) return 'Plain crossfade';
  if (seam.method === 'cut') return 'Cut';
  return `${seam.bars}-bar blend`;
}

export function MakeCloudMix({ api, account }: { api: Api; account: Pick<Account, 'features' | 'workspace'> }) {
  if (!featureOn(account, MIX_CREATE_FLAG)) return null;
  return <MixMaker api={api} workspaceId={account.workspace.id} localFirstEnabled={account.features['local_first.mix_readiness'] === true} />;
}

function MixMaker({ api, workspaceId, localFirstEnabled }: { api: Api; workspaceId: string; localFirstEnabled: boolean }) {
  const [mixes, setMixes] = useState<MixSummary[] | null>(null);
  const [library, setLibrary] = useState<Asset[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<{ mix: CloudMix; history: History } | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<DeviceTarget[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [deviceMessage, setDeviceMessage] = useState('');
  const [availability, setAvailability] = useState<Record<string, DeviceMixReadiness>>({});
  const [undoStack, setUndoStack] = useState<Array<{ ids: string[]; name: string }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ ids: string[]; name: string }>>([]);

  // Only the explicit LF device contract may provide local verification. A
  // historical cloud asset's "available" flag is not proof of local audio.
  useEffect(() => {
    if (!localFirstEnabled) {
      setDevices([]);
      setDeviceId('');
      return;
    }
    let active = true;
    void api<{ devices: DeviceTarget[] }>('/local-first/devices', {}, workspaceId)
      .then(result => {
        if (!active) return;
        const valid = Array.isArray(result.devices) ? result.devices.filter(
          device => device && typeof device.id === 'string' && typeof device.name === 'string',
        ) : [];
        setDevices(valid);
        setDeviceId(old => valid.some(device => device.id === old) ? old : valid[0]?.id ?? '');
        setDeviceMessage(valid.length ? '' : 'No local engine has reported device readiness.');
      }).catch(() => {
        if (!active) return;
        setDevices([]);
        setDeviceId('');
        setDeviceMessage('The local-engine registry is not available; recording readiness is unknown.');
      });
    return () => { active = false; };
  }, [api, workspaceId, localFirstEnabled]);

  const availabilityKey = (mixId: string, revision: string) => `${deviceId}:${mixId}:${revision}`;
  useEffect(() => {
    if (!localFirstEnabled || !deviceId || !mixes?.length) return;
    let active = true;
    // Detailed recipe IDs are necessary to validate repeated occurrences. A
    // summary count is never accepted as verification evidence by itself.
    for (const summary of mixes) {
      void (async () => {
        try {
          const found = await api<{ mix: CloudMix }>(
            `/cloud-mixes/${encodeURIComponent(summary.mix_id)}`, {}, workspaceId,
          );
          if (!active || found.mix.revision !== summary.revision) return;
          const expected = {
            deviceId, mixId: summary.mix_id, revision: summary.revision,
            tracks: referencesOf(found.mix.songs),
          };
          const result = await api<unknown>(
            `/local-first/devices/${encodeURIComponent(deviceId)}/mixes/${encodeURIComponent(summary.mix_id)}/availability?revision=${encodeURIComponent(summary.revision)}`,
            {}, workspaceId,
          );
          if (!active) return;
          const accepted = acceptReadiness(result, expected);
          if (accepted) {
            setAvailability(previous => ({ ...previous, [`${deviceId}:${summary.mix_id}:${summary.revision}`]: accepted }));
          }
        } catch {
          // A missing, offline, or incompatible verifier cannot make a mix ready.
        }
      })();
    }
    return () => { active = false; };
  }, [api, workspaceId, mixes, deviceId, localFirstEnabled]);

  const load = useCallback(async () => {
    try {
      const [listed, songs] = await Promise.all([
        api<{ mixes: MixSummary[] }>('/cloud-mixes', {}, workspaceId),
        api<{ assets: Asset[] }>('/assets?limit=100', {}, workspaceId),
      ]);
      setMixes(listed.mixes);
      setLibrary(songs.assets);
      setError('');
    } catch (failure) {
      setError(problem(failure, 'Your Cloud mixes could not be loaded.'));
    }
  }, [api, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const show = (mix: CloudMix, history: History) => {
    setOpen({ mix, history });
    setDraft(mix.songs.map((song) => song.id));
    setDraftName(mix.name);
    setUndoStack([]);
    setRedoStack([]);
  };

  const openMix = async (mixId: string) => {
    try {
      const found = await api<{ mix: CloudMix; history: History }>(`/cloud-mixes/${encodeURIComponent(mixId)}`, {}, workspaceId);
      show(found.mix, found.history);
      setError('');
    } catch (failure) {
      setError(problem(failure, 'That mix could not be opened.'));
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const made = await api<{ mix: CloudMix }>('/cloud-mixes', { method: 'POST', body: JSON.stringify({ name: name.trim() || 'Cloud mix', asset_ids: picked }) }, workspaceId);
      setPicked([]);
      setName('');
      await load();
      await openMix(made.mix.mix_id);
    } catch (failure) {
      setError(problem(failure, 'The mix could not be made.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async (body: Record<string, unknown>) => {
    if (!open) return;
    setBusy(true);
    try {
      await api<{ mix: CloudMix }>(`/cloud-mixes/${encodeURIComponent(open.mix.mix_id)}/revisions`, { method: 'POST', body: JSON.stringify({ base_revision: open.mix.revision, ...body }) }, workspaceId);
      await load();
      await openMix(open.mix.mix_id);
    } catch (failure) {
      setError(problem(failure, 'Your changes could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const editDraft = (ids: string[], nextName = draftName) => {
    if (ids.join('\u0000') === draft.join('\u0000') && nextName === draftName) return;
    setUndoStack(previous => [...previous, { ids: draft.slice(), name: draftName }].slice(-30));
    setRedoStack([]);
    setDraft(ids);
    setDraftName(nextName);
  };
  const move = (at: number, by: number) => {
    const next = draft.slice();
    const to = at + by;
    if (to < 0 || to >= next.length) return;
    [next[at], next[to]] = [next[to], next[at]];
    editDraft(next);
  };
  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack(stack => [...stack, { ids: draft.slice(), name: draftName }]);
    setUndoStack(stack => stack.slice(0, -1));
    setDraft(previous.ids);
    setDraftName(previous.name);
  };
  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack(stack => [...stack, { ids: draft.slice(), name: draftName }]);
    setRedoStack(stack => stack.slice(0, -1));
    setDraft(next.ids);
    setDraftName(next.name);
  };
  const applyVariation = (variation: RepairVariation) => {
    if (!open || variation.fromMixId !== open.mix.mix_id || variation.originalRevision !== open.mix.revision) return;
    const ids = referencesOf(open.mix.songs);
    const original = new Map(ids.map((track, index) => [track.occurrenceId, open.mix.songs[index].id]));
    const selected = variation.orderedOccurrenceIds.map(occurrence => original.get(occurrence));
    if (selected.some(id => !id)) return;
    editDraft(selected as string[]);
  };

  const nameOf = (id: string) => library.find((song) => song.id === id)?.name ?? open?.mix.songs.find((song) => song.id === id)?.title ?? 'Unknown song';
  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  const changed = open !== null && (draftName.trim() !== open.mix.name || draft.join() !== open.mix.songs.map((song) => song.id).join());

  return (
    <section className="cloud-card cloud-mix-maker" aria-labelledby="cloud-mix-heading">
      <p className="cloud-eyebrow">MIXES</p>
      <h2 id="cloud-mix-heading">Make a mix</h2>
      <p>Pick songs from your Cloud Library in the order you want. SelectaDJ plans each change from tempo and key where it knows them, and says plainly when a change is only a crossfade.</p>
      {error && <p className="cloud-mix-error" role="alert">{error}</p>}

      <form className="cloud-mix-new" onSubmit={(event) => void create(event)} aria-label="New mix">
        <label>Mix name <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Cloud mix" /></label>
        <ul className="cloud-mix-pick" aria-label="Songs to include">
          {library.map((song) => (
            <li key={song.id}>
              <label><input type="checkbox" checked={picked.includes(song.id)} onChange={() => toggle(song.id)} /> {song.name}{picked.includes(song.id) ? ` (${picked.indexOf(song.id) + 1})` : ''}</label>
            </li>
          ))}
        </ul>
        {library.length === 0 && mixes !== null && <p>Upload songs to your Cloud Library to make a mix.</p>}
        <button className="primary" type="submit" disabled={busy || picked.length < 2}>Make mix</button>
      </form>

      {deviceMessage && <p role="status">{deviceMessage}</p>}
      {!localFirstEnabled && <p className="lf11-muted">Local device verification is not yet enabled for this workspace. Saved mixes remain editable, but cloud asset availability does not prove they can play on a device.</p>}

      {mixes !== null && mixes.length > 0 && (
        <ul className="cloud-mix-list" aria-label="Your Cloud mixes">
          {mixes.map((mix) => (
            <li key={mix.mix_id}>
              <button onClick={() => void openMix(mix.mix_id)}>{mix.name}</button>
              <span>{mix.songs} songs · version {mix.number} · {mix.intelligent_seams} planned changes</span>
              <ReadinessBadge readiness={availability[availabilityKey(mix.mix_id, mix.revision)] ?? null} total={mix.songs} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="cloud-mix-editor" aria-label={`Edit ${open.mix.name}`} role="group">
          <label>Name <input value={draftName} maxLength={60} onChange={(event) => editDraft(draft, event.target.value)} /></label>
          <DeviceMixRepair
            mixId={open.mix.mix_id}
            revision={open.mix.revision}
            tracks={referencesOf(open.mix.songs)}
            devices={devices}
            deviceId={deviceId}
            onDeviceChange={setDeviceId}
            readiness={availability[availabilityKey(open.mix.mix_id, open.mix.revision)] ?? null}
            currentDraftChanged={changed}
            onApplyVariation={applyVariation}
          />
          <p className="lf11-muted">This editor preserves the saved arrangement even without playable audio. No waveform or preview is fabricated for unavailable recordings.</p>
          <ol className="cloud-mix-songs">
            {draft.map((id, at) => {
              const seam = at > 0 && draft.join() === open.mix.songs.map((song) => song.id).join() ? open.mix.seams[at - 1] : undefined;
              const gone = open.mix.songs.find((song) => song.id === id)?.available === false;
              return (
                <li key={`${id}-${at}`}>
                  {seam && <p className="cloud-mix-seam" data-basis={seam.basis}>{seamWords(seam)}: {seam.reason}</p>}
                  <span>{nameOf(id)}{gone ? ' (removed from your library)' : ''}</span>
                  <button aria-label={`Move ${nameOf(id)} earlier`} disabled={at === 0} onClick={() => move(at, -1)}>Up</button>
                  <button aria-label={`Move ${nameOf(id)} later`} disabled={at === draft.length - 1} onClick={() => move(at, 1)}>Down</button>
                  <button aria-label={`Remove ${nameOf(id)}`} onClick={() => editDraft(draft.filter((_, index) => index !== at))}>Remove</button>
                </li>
              );
            })}
          </ol>
          <label>Add a song <select value="" onChange={(event) => { const id = event.target.value; if (id) editDraft([...draft, id]); }}>
            <option value="">Choose a song</option>
            {library.map((song) => <option key={song.id} value={song.id}>{song.name}</option>)}
          </select></label>
          <div className="lf11-actions">
            <button disabled={busy || undoStack.length === 0} onClick={undo}>Undo edit</button>
            <button disabled={busy || redoStack.length === 0} onClick={redo}>Redo edit</button>
          </div>
          <button className="primary" disabled={busy || !changed || draft.length < 2} onClick={() => void save({ asset_ids: draft, name: draftName.trim() })}>Save as a new version</button>
          <p className="lf11-muted">Saving creates a new immutable recipe revision with conflict detection. The original is retained; local source substitutions are never silently saved.</p>
          {open.history.length > 1 && (
            <ul className="cloud-mix-history" aria-label="Earlier versions">
              {open.history.slice(1).map((entry) => (
                <li key={entry.revision}>
                  <span>Version {entry.number}: {entry.name}, {entry.songs} songs</span>
                  <button disabled={busy} onClick={() => void save({ restore: entry.revision })}>Restore version {entry.number}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
