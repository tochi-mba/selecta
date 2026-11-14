import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../api';
import { browserCloudCopy } from '../../copy';
import {
  checkedAvailability, useBrowserStudioPorts,
  type BrowserAvailability, type PortableRecipe, type RecipeHistoryEntry,
  type RecipeSummary, type StudioCue, type StudioRecording, type StudioTransition,
} from './browserPorts';

type Edit = Pick<PortableRecipe, 'name' | 'occurrences' | 'cues' | 'transitions' | 'draft'>;
type OpenRecipe = { recipe: PortableRecipe; headRevision: string; history: RecipeHistoryEntry[]; legacy: boolean };
type Mode = 'play' | 'remote' | 'edit';
const LABELS = {
  available: 'Available', preparing: 'Preparing', unsupported_here: 'Unsupported Here',
  missing_media: 'Missing Media', permission_required: 'Permission Required',
  alternative_master: 'Alternative Master — review required', cache_invalid: 'Cache Invalid',
  unknown: 'Unverified on this device',
};
const transitions: StudioTransition['type'][] = ['crossfade', 'cut', 'beatmatched_crossfade', 'planned'];
const isOpaque = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) && !/^[0-9a-f]{64}$/.test(value);
const makeEdit = (recipe: PortableRecipe): Edit => ({
  name: recipe.name, draft: recipe.draft,
  occurrences: recipe.occurrences.map((row) => ({ ...row })),
  cues: recipe.cues.map((row) => ({ ...row })),
  transitions: recipe.transitions.map((row) => ({ ...row })),
});
const sameEdit = (a: Edit, b: Edit) => JSON.stringify(a) === JSON.stringify(b);
const localKey = (workspace: string, id: string) => `br64-07:draft:${workspace}:${id}`;
const humanError = (reason: unknown) => reason instanceof Error ? reason.message : 'The operation could not be completed.';

function adjacentTransitions(ordered: StudioRecording[], old: StudioTransition[]) {
  return ordered.slice(1).map((item, at) => old.find((seam) =>
    seam.from_occurrence_id === ordered[at].occurrence_id && seam.to_occurrence_id === item.occurrence_id
  ) ?? {
    from_occurrence_id: ordered[at].occurrence_id, to_occurrence_id: item.occurrence_id,
    type: 'crossfade' as const, duration_seconds: 8, requires_rebuild: true,
  });
}

/** Browser-native, metadata-only mix editor. Files are never passed to Cloud API.
 * Missing media never prevents reading history, changing cues or saving a recipe. */
export function BrowserStudio({ api, workspaceId }: { api: Api; workspaceId: string }) {
  const ports = useBrowserStudioPorts();
  const [mode, setMode] = useState<Mode>(() => {
    const requested = new URLSearchParams(window.location.search).get('mode');
    return requested === 'play' || requested === 'remote' ? requested : 'edit';
  });
  const selectMode = (next: Mode) => {
    setMode(next);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', next);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  const [opened, setOpened] = useState<OpenRecipe | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [undo, setUndo] = useState<Edit[]>([]);
  const [redo, setRedo] = useState<Edit[]>([]);
  const [availability, setAvailability] = useState<BrowserAvailability | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [savedConflictDraft, setSavedConflictDraft] = useState<{ base: string; edit: Edit } | null>(null);
  const [readinessTime, setReadinessTime] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [exported, setExported] = useState<{ revision: string; filename: string; mimeType: string; blob: Blob } | null>(null);
  const renderAbort = useRef<AbortController | null>(null);
  const importedRef = useRef<HTMLInputElement>(null);
  const baseline = opened ? makeEdit(opened.recipe) : null;
  const dirty = !!edit && !!baseline && !sameEdit(edit, baseline);
  const active = opened?.recipe ?? null;
  // An unsaved edit is not the exact recipe revision that local verification covered.
  const verified = active && !dirty && ports.media
    ? checkedAvailability(active, availability, ports.media.deviceId, readinessTime) : null;
  // Never rely solely on the last rendered button state for an audio action:
  // freshness is rechecked synchronously at the user gesture.
  const currentlyVerified = () => active && !dirty && ports.media
    ? checkedAvailability(active, availability, ports.media.deviceId, Date.now()) : null;
  const renderSupported = active && ports.renderer?.supported(active);
  const allReady = verified?.allReady === true;
  const canRender = !!active && !dirty && allReady && renderSupported?.supported === true && !!ports.renderer;
  // The first sound check is performed AFTER user-activated local playback. Requiring
  // pre-existing physical audibility here creates a deadlock on a new browser.
  const canPlay = !!active && !dirty && allReady && !!ports.playback;

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ recipes: RecipeSummary[] }>('/cloud-mixes?schema_version=2', {}, workspaceId);
      setList(Array.isArray(result.recipes) ? result.recipes : []);
    } catch (cause) { setError(`Saved recipes could not be loaded: ${humanError(cause)}`); }
  }, [api, workspaceId]);

  const openRecipe = useCallback(async (id: string, discardDraft = false) => {
    try {
      const response = await api<{
        recipe: PortableRecipe; head_revision: string; history: RecipeHistoryEntry[]; legacy_read_only_view: boolean;
      }>(`/cloud-mixes/${encodeURIComponent(id)}?schema_version=2`, {}, workspaceId);
      if (response.recipe?.schema_version !== 2) throw new Error('Unsupported portable recipe revision.');
      const recipe = response.recipe;
      const next = makeEdit(recipe);
      let olderDraft: { base: string; edit: Edit } | null = null;
      if (!discardDraft) {
        try {
          const raw = window.sessionStorage.getItem(localKey(workspaceId, id));
          if (raw) {
            const recovered = JSON.parse(raw) as { base: string; edit: Edit };
            if (recovered.edit && typeof recovered.edit.name === 'string' &&
              Array.isArray(recovered.edit.occurrences) &&
              Array.isArray(recovered.edit.cues) && Array.isArray(recovered.edit.transitions)) {
              if (recovered.base === recipe.revision_id) {
                Object.assign(next, recovered.edit);
                setMessage('Recovered an unsaved local editing session. Nothing was overwritten in Cloud.');
              } else {
                olderDraft = recovered;
                setMessage('A saved revision changed while this browser was away. The earlier unsaved draft remains recoverable below.');
              }
            } else setMessage('The stored editing draft was invalid; the Cloud revision remains intact.');
          }
        } catch { setMessage('Saved local editing state could not be recovered; the Cloud revision remains intact.'); }
      } else {
        try { window.sessionStorage.removeItem(localKey(workspaceId, id)); } catch { /* optional local recovery */ }
      }
      setOpened({ recipe, headRevision: response.head_revision || recipe.revision_id, history: response.history ?? [], legacy: !!response.legacy_read_only_view });
      setEdit(next); setUndo([]); setRedo([]); setAvailability(null); setExported(null);
      setSavedConflictDraft(olderDraft); setConflict(!!olderDraft); setError('');
      const url = new URL(window.location.href);
      url.searchParams.set('mix', id);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (cause) { setError(`Could not open this recipe: ${humanError(cause)}`); }
  }, [api, workspaceId]);

  useEffect(() => {
    void refresh();
    const id = new URLSearchParams(window.location.search).get('mix');
    if (id && isOpaque(id)) void openRecipe(id);
  }, [refresh, openRecipe]);

  useEffect(() => {
    if (!opened || !edit || savedConflictDraft) return; // Preserve older revision drafts explicitly.
    try {
      const key = localKey(workspaceId, opened.recipe.recipe_id);
      if (sameEdit(edit, makeEdit(opened.recipe))) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, JSON.stringify({ base: opened.recipe.revision_id, edit }));
    } catch { /* No storage permission: edits still work until this tab closes. */ }
  }, [opened, edit, workspaceId, savedConflictDraft]);

  useEffect(() => {
    const timer = window.setInterval(() => setReadinessTime(Date.now()), 5000);
    const update = () => setReadinessTime(Date.now());
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);

  useEffect(() => () => { renderAbort.current?.abort(); }, []);

  useEffect(() => {
    if (!active || !ports.media) { setAvailability(null); return; }
    let live = true;
    const inspect = async () => {
      try {
        const report = await ports.media!.inspect(active);
        if (live) setAvailability(report);
      } catch {
        if (live) setAvailability(null); // Never treat a previous device's result as fresh.
      }
    };
    setAvailability(null);
    void inspect();
    return () => { live = false; };
  }, [active, ports.media]);

  const change = (next: Edit) => {
    if (!edit || sameEdit(edit, next)) return;
    setUndo((stack) => [...stack.slice(-39), edit]);
    setRedo([]);
    setEdit(next);
    setExported(null);
    setMessage('');
  };
  const step = (direction: 'undo' | 'redo') => {
    if (!edit) return;
    const from = direction === 'undo' ? undo : redo;
    const last = from.at(-1);
    if (!last) return;
    if (direction === 'undo') {
      setUndo((stack) => stack.slice(0, -1)); setRedo((stack) => [...stack, edit]);
    } else {
      setRedo((stack) => stack.slice(0, -1)); setUndo((stack) => [...stack, edit]);
    }
    setEdit(last);
  };
  const move = (index: number, by: number) => {
    if (!edit || index + by < 0 || index + by >= edit.occurrences.length) return;
    const next = edit.occurrences.slice();
    [next[index], next[index + by]] = [next[index + by], next[index]];
    change({ ...edit, occurrences: next, transitions: adjacentTransitions(next, edit.transitions) });
  };
  const cueFor = (id: string): StudioCue | undefined => edit?.cues.find((cue) => cue.occurrence_id === id);
  const changeCue = (id: string, value: string) => {
    if (!edit) return;
    const seconds = value.trim() === '' ? null : Number(value);
    if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0 || seconds > 604800)) return;
    const cues = edit.cues.filter((cue) => cue.occurrence_id !== id);
    if (seconds !== null) cues.push({ occurrence_id: id, at: seconds, timebase: 'source_seconds', requires_revalidation: true });
    change({ ...edit, cues });
  };
  const updateTransition = (index: number, next: Partial<StudioTransition>) => {
    if (!edit) return;
    const changed = edit.transitions.map((seam, at) => at === index ? { ...seam, ...next, requires_rebuild: true } : seam);
    change({ ...edit, transitions: changed });
  };

  const save = async () => {
    if (!active || !edit || !dirty || busy) return;
    setBusy(true); setError(''); setConflict(false);
    try {
      await api(`/cloud-mixes/${encodeURIComponent(active.recipe_id)}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          schema_version: 2, base_revision: opened!.headRevision,
          changes: edit,
        }),
      }, workspaceId);
      setMessage('A new immutable recipe revision was saved. Previous revisions remain available.');
      await openRecipe(active.recipe_id, true);
      await refresh();
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 409) {
        setConflict(true);
        setError('This recipe has a newer revision. Your local changes are preserved; compare and reapply them deliberately.');
      } else setError(humanError(cause));
    } finally { setBusy(false); }
  };

  const restore = async (revision: string) => {
    if (!active || busy || dirty || revision === active.revision_id) return;
    if (!window.confirm('Restore this earlier arrangement as a NEW revision? Existing history will be kept.')) return;
    setBusy(true); setError('');
    try {
      await api(`/cloud-mixes/${encodeURIComponent(active.recipe_id)}/revisions`, {
        method: 'POST',
        body: JSON.stringify({ schema_version: 2, base_revision: opened!.headRevision, restore: revision }),
      }, workspaceId);
      await openRecipe(active.recipe_id, true);
      await refresh();
      setMessage('Earlier version restored as a new revision.');
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  };

  const chooseFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!ports.media) { setError('Browser music access is not connected. Saved recipes remain editable without audio.'); return; }
    setBusy(true); setError('');
    try {
      const selected = await ports.media.importFiles(Array.from(files));
      if (!selected.length) { setMessage('No verified, supported recordings were imported.'); return; }
      if (selected.some((track) => !isOpaque(track.canonical_track_id) ||
        (track.recording_version !== null && !isOpaque(track.recording_version)))) {
        throw new Error('The local media adapter did not return valid canonical recording references.');
      }
      const occurrences = selected.map((row) => ({
        ...row, occurrence_id: crypto.randomUUID().replaceAll('-', ''),
      }));
      if (edit) {
        const next: StudioRecording[] = [...edit.occurrences, ...occurrences.map((row) => ({
          ...row, legacy_asset_id: null, analysis_valid: false,
        }))];
        change({ ...edit, occurrences: next, transitions: adjacentTransitions(next, edit.transitions) });
        setMessage('Imported recordings were added to your unsaved recipe. Save a new version when ready.');
      } else {
        const created = await api<{ recipe: PortableRecipe }>('/cloud-mixes', {
          method: 'POST',
          body: JSON.stringify({ schema_version: 2, name: 'New browser mix', occurrences }),
        }, workspaceId);
        await refresh();
        await openRecipe(created.recipe.recipe_id, true);
        setMessage('New portable recipe created. Audio remains in this browser.');
      }
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); if (importedRef.current) importedRef.current.value = ''; }
  };

  const play = async () => {
    if (!canPlay || !active || !ports.playback || !currentlyVerified()?.allReady) return;
    setBusy(true); setError('');
    try { await ports.playback.playHere(active); setMessage('Playback requested locally. Confirm sound at your actual speaker.'); }
    catch (cause) { setError(`Could not start local playback: ${humanError(cause)}`); }
    finally { setBusy(false); }
  };
  const remote = async () => {
    if (!ports.playback) return;
    setBusy(true); setError('');
    try { await ports.playback.controlAnotherDevice(); setMessage('Remote control requested. The other player must acknowledge commands.'); }
    catch (cause) { setError(`Remote control unavailable: ${humanError(cause)}`); }
    finally { setBusy(false); }
  };

  const prepare = async () => {
    if (!active || !currentlyVerified()?.allReady || dirty || !ports.renderer?.prepare) return;
    setBusy(true); setError('');
    try { await ports.renderer.prepare(active); setMessage('Local transition preparation requested. Recheck the seams before playing.'); }
    catch (cause) { setError(`Preparing failed: ${humanError(cause)}`); }
    finally { setBusy(false); }
  };
  const preview = async (index: number) => {
    if (!active || !currentlyVerified()?.allReady || dirty || !ports.playback?.previewTransition) return;
    setBusy(true); setError('');
    try {
      await ports.playback.previewTransition(active, index);
      setMessage('Preview requested in this browser. Check actual output before playing the full mix.');
    } catch (cause) { setError(`Preview unavailable: ${humanError(cause)}`); }
    finally { setBusy(false); }
  };

  const render = async () => {
    if (!canRender || !active || !ports.renderer || !currentlyVerified()?.allReady || !ports.renderer.supported(active).supported) return;
    const abort = new AbortController();
    renderAbort.current = abort;
    setRendering(true); setError('');
    try {
      const artifact = await ports.renderer.render(active, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!(artifact.blob instanceof Blob) || !artifact.blob.size) throw new Error('The renderer returned no downloadable audio.');
      if (!artifact.mimeType.startsWith('audio/')) throw new Error('The renderer returned a non-audio export.');
      setExported({ revision: active.revision_id, filename: artifact.filename, mimeType: artifact.mimeType, blob: artifact.blob });
      setMessage('Render ready on this device. Tap Download local export to save the audio.');
    } catch (cause) {
      if (!abort.signal.aborted) setError(`Render Failed: ${humanError(cause)}`);
      else setMessage('Local render cancelled. No saved recipe revision was changed.');
    } finally { renderAbort.current = null; setRendering(false); }
  };

  const downloadExport = () => {
    // A new direct user gesture is necessary for some iOS/Safari download flows.
    if (!exported || !active || exported.revision !== active.revision_id || dirty || busy) return;
    const url = URL.createObjectURL(exported.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exported.filename.replace(/[\\/]/g, '_').slice(0, 128) || 'selecta-mix-export';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setMessage('Local export download requested. Check your browser downloads or share sheet.');
  };

  return <section className="br07-studio" aria-label="Personal browser Studio">
    <div className="br07-intro">
      <div><p className="cloud-eyebrow">LOCAL MUSIC · PORTABLE MIXES</p><h2>Studio, on this device</h2>
        <p>{browserCloudCopy.privacy}</p></div>
      <div className="br07-modes" role="group" aria-label="How to use Studio">
        <button type="button" aria-pressed={mode === 'play'} onClick={() => selectMode('play')}>Play Here</button>
        <button type="button" aria-pressed={mode === 'remote'} onClick={() => selectMode('remote')}>Control Another Device</button>
        <button type="button" aria-pressed={mode === 'edit'} onClick={() => selectMode('edit')}>Edit Without Music</button>
      </div>
    </div>
    {mode === 'play' && <div className="br07-callout" role="status">Choose files on this phone, tablet or computer, check exact recording readiness and confirm physical output. No installer is required. {ports.media ? 'Browser media adapter connected.' : 'Browser media integration is not connected yet.'}</div>}
    {mode === 'remote' && <div className="br07-callout" role="status"><p>Control an already-authorised, active player. Its music does not stream to this device.</p>
      <button disabled={!ports.playback || busy} onClick={() => void remote()}>Connect to another player</button>
      {!ports.playback && <small>Remote control will be available when browser sessions are integrated.</small>}</div>}
    {mode === 'edit' && <p className="br07-callout">No recordings needed. Open saved mixes, adjust order and cues, review version history and save new revisions from any browser.</p>}
    {error && <p className="cloud-feedback error" role="alert">{error}</p>}
    {message && <p className="cloud-feedback" role="status">{message}</p>}
    <div className="br07-workspace">
      <aside className="br07-recipes" aria-label="Saved portable mixes">
        <div className="br07-heading"><h3>My Mixes</h3><button onClick={() => void refresh()} disabled={busy}>Refresh</button></div>
        {list === null ? <p>Loading saved recipes…</p> : list.length === 0 ? <p>No saved mixes yet. Select local files to create one once browser music access is connected.</p> :
          <ul>{list.map((item) => <li key={item.recipe_id}><button
            className={opened?.recipe.recipe_id === item.recipe_id ? 'br07-current' : ''}
            aria-current={opened?.recipe.recipe_id === item.recipe_id ? 'true' : undefined}
            onClick={() => void openRecipe(item.recipe_id)}><strong>{item.name}</strong>
            <small>{item.occurrences} tracks · revision {item.revision_number}</small></button></li>)}</ul>}
        <label className="br07-import">Choose music files on this device
          <input ref={importedRef} type="file" accept="audio/*" multiple disabled={!ports.media || busy}
            onChange={(event) => void chooseFiles(event.target.files)} />
        </label>
        {!ports.media && <p className="br07-muted">Local file access is not connected. This is not a Cloud upload control.</p>}
      </aside>
      <div className="br07-editor">
        {!opened || !edit ? <div className="cloud-card"><h3>Open a saved mix</h3><p>Choose a recipe to edit its arrangement. Exact audio readiness is checked separately on each device.</p></div> : <>
          <header className="br07-heading"><div><p className="cloud-eyebrow">PORTABLE RECIPE · REVISION {opened.recipe.revision_number}</p>
            <h3>{opened.recipe.name}</h3><p>{dirty ? 'Unsaved draft (media must be reverified after saving)' : opened.legacy ? 'Legacy mix reference — source media unverified' : 'Immutable saved revision'}</p></div>
            <div className="br07-actions"><button onClick={() => step('undo')} disabled={!undo.length}>Undo</button>
              <button onClick={() => step('redo')} disabled={!redo.length}>Redo</button>
              <button className="primary" onClick={() => void save()} disabled={!dirty || busy}>Save new version</button></div>
          </header>
          {conflict && <div className="br07-callout" role="alert">
            <p>A newer revision exists. Your draft is not merged or overwritten automatically. Check the earlier changes before discarding them.</p>
            {savedConflictDraft && <details>
              <summary>Review recoverable earlier draft (metadata only)</summary>
              <p>Based on revision {savedConflictDraft.base.slice(0, 12)}. Copy the relevant changes and reapply them deliberately to the current revision.</p>
              <pre className="br07-recovery-json">{JSON.stringify(savedConflictDraft.edit, null, 2)}</pre>
            </details>}
            <button onClick={() => {
              if (window.confirm('Discard the saved local draft and load the latest Cloud revision?')) void openRecipe(opened.recipe.recipe_id, true);
            }}>Discard draft and load latest</button></div>}
          <label className="br07-name">Mix name <input value={edit.name} maxLength={60}
            onChange={(event) => change({ ...edit, name: event.target.value })} /></label>
          <div className="br07-heading"><h4>Arrangement and cues</h4><small>Move up/down works with touch, keyboard and screen readers</small></div>
          <ol className="br07-timeline">{edit.occurrences.map((row, index) => {
            const media = verified?.rows[index];
            const status = dirty ? 'Unsaved edit — unverified' : LABELS[media?.state ?? 'unknown'];
            return <li key={row.occurrence_id} className="br07-track">
              <div className="br07-track-head"><div><strong>{index + 1}. {row.title}</strong>
                <small>{row.artist || 'Unknown artist'} · {row.recording_version || 'Version unspecified'}</small></div>
                <span className="br07-state" data-state={media?.state ?? 'unknown'}>{status}</span></div>
              {media?.reason && !dirty && <p className="br07-muted">{media.reason}</p>}
              {media?.state === 'alternative_master' && <p className="br07-muted">Alternate mastering cannot replace the exact recording automatically. Verify its identity first.</p>}
              <div className="br07-track-controls">
                <button aria-label={`Move ${row.title} earlier`} disabled={index === 0} onClick={() => move(index, -1)}>↑ Move earlier</button>
                <button aria-label={`Move ${row.title} later`} disabled={index === edit.occurrences.length - 1} onClick={() => move(index, 1)}>↓ Move later</button>
                <label>Cue (seconds) <input type="number" min="0" max="604800" step="0.1"
                  aria-label={`Cue seconds for ${row.title}`} value={cueFor(row.occurrence_id)?.at ?? ''}
                  onChange={(event) => changeCue(row.occurrence_id, event.target.value)} /></label>
              </div>
              {index > 0 && edit.transitions[index - 1] && <div className="br07-seam">
                <strong>Transition from previous</strong>
                <label>Type <select value={edit.transitions[index - 1].type} onChange={(event) =>
                  updateTransition(index - 1, { type: event.target.value as StudioTransition['type'] })}>
                  {transitions.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}
                </select></label>
                <label>Duration (seconds) <input type="number" min="0" max="604800" step="0.1"
                  value={edit.transitions[index - 1].duration_seconds}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next) && next >= 0 && next <= 604800) updateTransition(index - 1, { duration_seconds: next });
                  }} /></label>
                <span>{edit.transitions[index - 1].requires_rebuild ? 'Preview needs local preparation' : 'Saved transition intention'}</span>
                <button disabled={!allReady || dirty || busy || !ports.playback?.previewTransition}
                  aria-label={`Preview transition into ${row.title}`}
                  onClick={() => void preview(index - 1)}>Preview seam here</button>
              </div>}
            </li>;
          })}</ol>
          <section className="br07-readiness" aria-label="Local rendering and playback readiness">
            <h4>On this device</h4>
            <p role="status">{verified ? `${verified.ready} of ${verified.total} exact recordings verified` : 'Exact recording availability is unknown until this browser checks its local sources.'}</p>
            <p>{dirty ? 'Save this arrangement before preparing or exporting its new revision.' :
              !allReady ? 'Missing, permission-blocked or unverified recordings prevent complete playback and rendering; you can still edit.' :
              verified?.outputVerified ? 'Recording and output preflight passed. Confirm sound at your actual speaker.' :
              'Recordings available; Output Unverified. Confirm real speaker output before playback.'}</p>
            <div className="br07-actions">
              <button onClick={() => void prepare()} disabled={!allReady || dirty || busy || rendering || !ports.renderer?.prepare}>Prepare transitions locally</button>
              <button onClick={() => void play()} disabled={!canPlay || busy || rendering}>Play Here</button>
              <button onClick={() => void render()} disabled={!canRender || busy || rendering}>{rendering ? 'Rendering locally…' : 'Render and export here'}</button>
              {rendering && <button onClick={() => renderAbort.current?.abort()}>Cancel render</button>}
              {exported && exported.revision === active.revision_id && !dirty &&
                <button className="primary" onClick={downloadExport} disabled={busy || rendering}>Download local export</button>}
            </div>
            {!ports.renderer ? <p className="br07-muted">Local render adapter not connected. Phone rendering is supported when device capabilities and renderer are verified; no Cloud fallback is used.</p> :
              !renderSupported?.supported && <p className="br07-muted">Unsupported Here: {renderSupported?.reason ?? 'This device cannot complete this render.'}</p>}
          </section>
          <details className="br07-history"><summary>Version history ({opened.history.length})</summary>
            <ol>{opened.history.map((version) => <li key={version.revision}>
              <span>Revision {version.number} · {version.name} · schema v{version.schema_version}</span>
              <button disabled={busy || dirty || version.revision === opened.headRevision}
                onClick={() => void restore(version.revision)}>Restore as new version</button></li>)}</ol>
          </details>
        </>}
      </div>
    </div>
  </section>;
}

/** Persistent status surface for every personal Cloud destination. Never mount the
 * legacy hosted-audio transport when local_first.personal is enabled. */
export function BrowserPlaybackDock({ openStudio }: { openStudio: () => void }) {
  const ports = useBrowserStudioPorts();
  const status = ports.playback?.status();
  return <section className="br07-dock" aria-label="Browser player status" role="status">
    <span><strong>{status?.deviceLabel ?? 'This browser'}</strong> · {status?.playing ? 'Player active' : 'No confirmed active playback'} · {status?.outputVerified ? 'Output checked' : 'Output Unverified'}</span>
    <button onClick={openStudio}>Open Studio and player</button>
    <small>{status?.detail ?? 'Choose Play Here, Control Another Device or Edit Without Music.'}</small>
  </section>;
}
