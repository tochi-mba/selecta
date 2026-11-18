// Hosted mode only (ADR-0462): local-first accounts get the shared views and shell player instead.
import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { accountFlagOn, type FlagId } from '../flags';
import { Skeleton } from '../ui/controls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { countOf, Truncate } from '../ui/format';
import { CloudError, type Account, type Api, type Asset } from './api';
import './makeCloudMix.css';

// Make and edit a mix from Cloud Library songs (ADR-0418, flag `cloud.mix_create`). Each save is
// a new immutable revision of the shared mix contract; an edit names the revision it was made
// from, so a stale edit is refused rather than overwriting someone else's change. Seams say what
// they really are: a plain crossfade until both songs have tempo and key facts. With the flag off
// this renders nothing and Cloud Listen is exactly as before.

export const MIX_CREATE_FLAG: FlagId = 'cloud.mix_create';

type Facts = { bpm: number | null; camelot: string | null; energy: number | null };
export type MixSong = { source: string; id: string; title: string; artist: string | null; duration: number | null; facts: Facts; available?: boolean };
export type MixSeam = { into: number; method: string; bars: number; basis: string; intelligent: boolean; reason: string };
export type CloudMix = { mix_id: string; name: string; number: number; parent: string | null; revision: string; songs: MixSong[]; seams: MixSeam[]; intelligent_seams: number };
export type MixSummary = { mix_id: string; name: string; revision: string; number: number; songs: number; intelligent_seams: number; updated_at: number };
type History = { revision: string; number: number; name: string; songs: number }[];
/** One song in the editor. `key` is its own for as long as it is in the draft, so a move or a
 * remove never hands one row's focus or state to its neighbour (the same song may appear twice). */
type DraftSong = { key: number; id: string };
/** After a move or remove, the control that should have focus: a row's button, or the song picker. */
type FocusAim = { key: number; part: 'up' | 'down' | 'remove' } | { key: null; part: 'add' };

function problem(error: unknown, fallback: string) {
  return error instanceof CloudError || error instanceof Error ? error.message : fallback;
}

function seamWords(seam: MixSeam) {
  if (!seam.intelligent) return 'Plain crossfade';
  if (seam.method === 'cut') return 'Cut';
  return `${seam.bars}-bar blend`;
}

export function MakeCloudMix({ api, account }: { api: Api; account: Pick<Account, 'features' | 'workspace'> }) {
  if (!accountFlagOn(MIX_CREATE_FLAG, account.features)) return null;
  // Songs come from stored media (ADR-0456): with `cloud.stored_media` off there is no library
  // to read, so the maker never asks the server for one.
  return <MixMaker api={api} workspaceId={account.workspace.id} stored={accountFlagOn('cloud.stored_media', account.features)} uploads={accountFlagOn('cloud.uploads', account.features)} />;
}

function MixMaker({ api, workspaceId, stored, uploads }: { api: Api; workspaceId: string; stored: boolean; uploads: boolean }) {
  const [mixes, setMixes] = useState<MixSummary[] | null>(null);
  const [library, setLibrary] = useState<Asset[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<{ mix: CloudMix; history: History } | null>(null);
  const [draft, setDraft] = useState<DraftSong[]>([]);
  const nextKey = useRef(1);
  const keyed = (ids: string[]) => ids.map((id) => ({ key: nextKey.current++, id }));
  const aim = useRef<FocusAim | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  // a mix asked for while edits are unsaved waits for "Leave without saving"
  const [leaving, setLeaving] = useState<{ title: string; go: () => Promise<void> } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [listed, songs] = await Promise.all([
        api<{ mixes: MixSummary[] }>('/cloud-mixes', {}, workspaceId),
        stored ? api<{ assets: Asset[] }>('/assets?limit=100', {}, workspaceId) : Promise.resolve({ assets: [] as Asset[] }),
      ]);
      setMixes(listed.mixes);
      setLibrary(songs.assets);
      setError('');
    } catch (failure) {
      setError(problem(failure, 'Your Cloud mixes could not be loaded.'));
    }
  }, [api, workspaceId, stored]);

  useEffect(() => { void load(); }, [load]);

  const show = (mix: CloudMix, history: History) => {
    setOpen({ mix, history });
    setDraft(keyed(mix.songs.map((song) => song.id)));
    setDraftName(mix.name);
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

  const move = (at: number, by: number) => {
    const to = at + by;
    if (to < 0 || to >= draft.length) return;
    const song = draft[at];
    // focus rides with the song; at either end the pressed button is gone, so the other one takes it
    const part = by < 0 ? (to === 0 ? 'down' : 'up') : (to === draft.length - 1 ? 'up' : 'down');
    aim.current = { key: song.key, part };
    setDraft((rows) => {
      const next = rows.slice();
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });
  };
  const removeAt = (at: number) => {
    const neighbour = draft[at + 1] ?? draft[at - 1];
    aim.current = neighbour ? { key: neighbour.key, part: 'remove' } : { key: null, part: 'add' };
    setDraft((rows) => rows.filter((_, index) => index !== at));
  };
  useLayoutEffect(() => {
    const target = aim.current;
    if (!target) return;
    aim.current = null;
    const selector = target.key === null ? '[data-mix-add]' : `[data-mix-row="${target.key}"] [data-mix-part="${target.part}"]`;
    editor.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [draft]);

  const nameOf = (id: string) => library.find((song) => song.id === id)?.name ?? open?.mix.songs.find((song) => song.id === id)?.title ?? 'Unknown song';
  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  const draftIds = draft.map((song) => song.id);
  const sameSongs = open !== null && draftIds.join() === open.mix.songs.map((song) => song.id).join();
  const changed = open !== null && (draftName.trim() !== open.mix.name || !sameSongs);
  // Opening another mix or an earlier version over unsaved edits asks first.
  const guard = (title: string, go: () => Promise<void>) => {
    if (changed) setLeaving({ title, go });
    else void go();
  };

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
              <label><input type="checkbox" checked={picked.includes(song.id)} onChange={() => toggle(song.id)} /> <span dir="auto">{song.name}</span>{picked.includes(song.id) ? ` (${picked.indexOf(song.id) + 1})` : ''}</label>
            </li>
          ))}
        </ul>
        {library.length === 0 && mixes !== null && <p>{uploads ? 'Upload songs to your Cloud Library to make a mix.' : 'Songs in your Cloud Library can be made into a mix.'}</p>}
        <button className="primary" type="submit" disabled={busy || picked.length < 2}>Make mix</button>
      </form>

      {mixes === null && !error && <Skeleton variant="rows" lines={3} label="Loading your Cloud mixes" />}
      {mixes !== null && mixes.length > 0 && (
        <ul className="cloud-mix-list" aria-label="Your Cloud mixes">
          {mixes.map((mix) => (
            <li key={mix.mix_id}>
              <button onClick={() => guard(`Open ${mix.name} without saving?`, () => openMix(mix.mix_id))}><Truncate text={mix.name} /></button>
              <span>{countOf(mix.songs, 'song')} · version {mix.number} · {countOf(mix.intelligent_seams, 'planned change')}</span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div ref={editor} className="cloud-mix-editor" aria-label={`Edit ${open.mix.name}`} role="group">
          <label>Name <input value={draftName} maxLength={60} onChange={(event) => setDraftName(event.target.value)} /></label>
          <ol className="cloud-mix-songs">
            {draft.map(({ key, id }, at) => {
              const seam = at > 0 && sameSongs ? open.mix.seams[at - 1] : undefined;
              const gone = open.mix.songs.find((song) => song.id === id)?.available === false;
              return (
                <li key={key} data-mix-row={key}>
                  {seam && <p className="cloud-mix-seam" data-basis={seam.basis}>{seamWords(seam)}: {seam.reason}</p>}
                  <span dir="auto">{nameOf(id)}{gone ? ' (removed from your library)' : ''}</span>
                  <button data-mix-part="up" aria-label={`Move ${nameOf(id)} earlier`} disabled={at === 0} onClick={() => move(at, -1)}>Up</button>
                  <button data-mix-part="down" aria-label={`Move ${nameOf(id)} later`} disabled={at === draft.length - 1} onClick={() => move(at, 1)}>Down</button>
                  <button data-mix-part="remove" aria-label={`Remove ${nameOf(id)}`} onClick={() => removeAt(at)}>Remove</button>
                </li>
              );
            })}
          </ol>
          <label>Add a song <select data-mix-add="" value="" onChange={(event) => { const id = event.target.value; if (id) setDraft((rows) => [...rows, ...keyed([id])]); }}>
            <option value="">Choose a song</option>
            {library.map((song) => <option key={song.id} value={song.id}>{song.name}</option>)}
          </select></label>
          <button className="primary" disabled={busy || !changed || draft.length < 2} onClick={() => void save({ asset_ids: draftIds, name: draftName.trim() })}>Save as a new version</button>
          {open.history.length > 1 && (
            <ul className="cloud-mix-history" aria-label="Earlier versions">
              {open.history.slice(1).map((entry) => (
                <li key={entry.revision}>
                  <span>Version {entry.number}: {entry.name}, {entry.songs} songs</span>
                  <button disabled={busy} onClick={() => guard(`Restore version ${entry.number} without saving?`, () => save({ restore: entry.revision }))}>Restore version {entry.number}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {leaving && open && (
        <ConfirmDialog
          title={leaving.title}
          body={`Your changes to ${open.mix.name} aren’t saved yet. Leaving drops them; the saved version stays as it is.`}
          confirmLabel="Leave without saving"
          cancelLabel="Keep editing"
          onConfirm={leaving.go}
          onClose={() => setLeaving(null)}
        />
      )}
    </section>
  );
}
