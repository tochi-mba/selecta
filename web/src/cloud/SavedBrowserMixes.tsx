import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { MixData } from '../api';
import { navigate } from '../router';
import { Action, Dialog, Menu, Skeleton, Status } from '../ui/controls';
import { countOf, relativeTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { MenuItem } from '../ui/primitives';
import type { ViewProps } from '../views/shared';
import { EMPTY_MIX } from './localFirstRequest';
import { copyName, MIX_NAME_LIMIT, type RecipeStore, type RecipeSummary } from './recipeStore';
import { flagOn } from '../flags';
import { length } from '../lib';
import { CoverArt } from '../views/CoverArt';
import './cloudMusic.css';
import { MIX_OUTBOX_EVENT, takeOutboxNotices, WAITING_TO_SYNC } from './outbox';

/** My Mixes' saved browser mixes, laid out as local mode lays out its drafts (views/Drafts.tsx):
 * a section with its own action, a line on what saving means here, and a row per mix with Edit,
 * Play and a menu (Rename, Copy, Delete). A browser mix is a recipe on the account (ADR-0458), so
 * it opens on any device holding the same music; the editor and player work on the current mix,
 * so Edit and Play first make the chosen mix current. */
export function SavedBrowserMixes({ workspaceId, recipes, request, setMixData, refreshStatus, player, notify, phase = 'idle', currentSeconds }: {
  workspaceId: string;
  recipes: RecipeStore;
  request: NonNullable<ViewProps['request']>;
  setMixData: ViewProps['setMixData'];
  refreshStatus: ViewProps['refreshStatus'];
  player: ViewProps['player'];
  notify: ViewProps['notify'];
  /** Whether the current mix is playing, paused or idle, so its row can say so. */
  phase?: ViewProps['now']['phase'];
  /** How long the current mix's songs run, in seconds; the only mix whose songs are loaded. */
  currentSeconds?: number;
}) {
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  const [problem, setProblem] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RecipeSummary | null>(null);
  const latest = useRef({ recipes, request, setMixData, refreshStatus });
  latest.current = { recipes, request, setMixData, refreshStatus };

  const load = useCallback(() => {
    setProblem('');
    return latest.current.recipes.list().then(setList).catch((error: Error) => setProblem(error.message || 'Couldn’t load your saved mixes.'));
  }, []);
  useEffect(() => {
    setList(null);
    void load();
  }, [load, workspaceId]);
  // cloud.mix_outbox: redraw when changes made offline are queued or sent, and say once when one
  // had to be saved as a copy
  const outbox = flagOn('cloud.mix_outbox');
  const [synced, setSynced] = useState('');
  useEffect(() => {
    if (!outbox) return;
    const heard = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== workspaceId) return;
      void load();
      const notices = takeOutboxNotices(workspaceId);
      if (notices.length) setSynced(notices[notices.length - 1]);
    };
    window.addEventListener(MIX_OUTBOX_EVENT, heard);
    const waiting = takeOutboxNotices(workspaceId);
    if (waiting.length) setSynced(waiting[waiting.length - 1]);
    return () => window.removeEventListener(MIX_OUTBOX_EVENT, heard);
  }, [outbox, load, workspaceId]);

  /** Make a saved mix the current one; the old pointer comes back if that fails. */
  const makeCurrent = async (recipe: RecipeSummary) => {
    const { recipes: store, request: ask, setMixData: show, refreshStatus: refresh } = latest.current;
    const previous = store.current();
    store.setCurrent(recipe.mix_id);
    try {
      show(await ask<MixData>('/mix'));
      refresh();
    } catch (error) {
      store.setCurrent(previous);
      throw error;
    }
  };
  const edit = async (recipe: RecipeSummary) => {
    await makeCurrent(recipe);
    navigate('/mix/current/edit');
  };
  const play = async (recipe: RecipeSummary) => {
    await makeCurrent(recipe);
    navigate('/listen');
    await player.playFrom(0);
  };
  const copy = async (recipe: RecipeSummary) => {
    const made = await recipes.duplicate(recipe.mix_id, copyName(recipe.name));
    await load();
    notify(`Saved a copy: ${made.name}.`);
  };
  const saveCurrent = async () => {
    const current = recipes.current();
    if (!current) return;
    // the name comes from the list when it is there, else from the mix itself; failing both the
    // server names the copy
    const known = list?.find((recipe) => recipe.mix_id === current)?.name
      ?? await recipes.read(current).then((mix) => mix.name, () => undefined);
    const made = await recipes.duplicate(current, known ? copyName(known) : undefined);
    await load();
    notify(`Saved a copy: ${made.name}.`);
  };
  const rename = async (recipe: RecipeSummary, name: string) => {
    const fresh = await recipes.read(recipe.mix_id);
    await recipes.edit(recipe.mix_id, fresh.revision, { name });
    setRenaming(null);
    notify(`Renamed to ${name}.`);
    if (recipes.current() === recipe.mix_id) setMixData(await request<MixData>('/mix'));
    await load();
  };
  const remove = async (recipe: RecipeSummary) => {
    const wasCurrent = recipes.current() === recipe.mix_id;
    const queued = (await recipes.remove(recipe.mix_id)) === 'queued';
    if (wasCurrent) {
      recipes.setCurrent(null);
      setMixData(EMPTY_MIX);
      refreshStatus();
    }
    setDeleting(null);
    await load();
    // cloud.mix_outbox: deleted while offline, it is sent on reconnect and can be taken back until then
    if (queued && recipes.restore) {
      notify(`Deleted ${recipe.name}. This reaches your account when the connection is back.`, async () => {
        await recipes.restore?.(recipe.mix_id);
        if (wasCurrent && !recipes.current()) {
          recipes.setCurrent(recipe.mix_id);
          setMixData(await request<MixData>('/mix'));
          refreshStatus();
        }
        await load();
      });
    } else notify(`Deleted ${recipe.name}.`);
  };

  const currentId = recipes.current();
  const now = Date.now() / 1000;
  const live = phase === 'playing' || phase === 'loading';
  return (
    <section className="saved-mixes" aria-labelledby="saved-browser-mixes">
      <div className="section-head">
        <h2 className="section-title" id="saved-browser-mixes">Saved mixes{!!list?.length && <span className="badge">{list.length}</span>}</h2>
        <Action className="small" working="Saving…" run={saveCurrent} disabled={!currentId}>Save a copy of the current mix</Action>
      </div>
      {outbox && synced && <p className="hint" role="status">{synced} <button className="small quiet" onClick={() => setSynced('')}>Dismiss</button></p>}
      {problem && <p className="warn" role="alert">{problem} <button className="small" onClick={() => void load()}>Try again</button></p>}
      {list === null && !problem && <Skeleton variant="rows" lines={3} label="Loading saved mixes" />}
      {list?.length === 0 && (
        <div className="empty-state boxed music-empty">
          <span className="empty-state-icon" aria-hidden="true"><Icon name="mixes" /></span>
          <h3>No saved mixes yet</h3>
          <p>Make a mix and it is saved here as you go.</p>
          <div className="empty-state-actions"><button className="primary big" onClick={() => navigate('/mixes')}>Make a Mix</button></div>
        </div>
      )}
      {!!list?.length && (
        <ul className="mix-rows">
          {list.map((recipe) => {
            const current = recipe.mix_id === currentId;
            const waiting = outbox && recipe.pending;
            return (
              <li className="mix-row" key={recipe.mix_id} data-current={current || undefined}>
                <CoverArt seed={recipe.mix_id} />
                <div className="mix-row-words">
                  {renaming === recipe.mix_id ? (
                    <RenameMix name={recipe.name} onCancel={() => setRenaming(null)} onSave={(name) => rename(recipe, name)} />
                  ) : (
                    <b className="mix-row-name" dir="auto" title={recipe.name}>{recipe.name}</b>
                  )}
                  <span className="mix-row-meta">
                    {current && <span className="badge" data-tone="accent">{live ? 'Playing now' : phase === 'paused' ? 'Paused' : 'Current mix'}</span>}
                    <span>{countOf(recipe.songs, 'song')}</span>
                    {current && !!currentSeconds && <span>About {length(currentSeconds)}</span>}
                    <span>{waiting ? 'Saved on this device' : `Saved ${relativeTime(now - recipe.updated_at)}`}</span>
                    {waiting && <Status kind="queued">{WAITING_TO_SYNC}</Status>}
                  </span>
                </div>
                <div className="mix-row-actions">
                  {current && phase !== 'idle'
                    ? <button className="primary" aria-label={`Open ${recipe.name} in Listen`} onClick={() => navigate('/listen')}>Open</button>
                    : <Action className={current ? 'primary' : 'mix-row-play'} working="Starting…" aria-label={`Play ${recipe.name}`} run={() => play(recipe)}><Icon name="play" /> Play</Action>}
                  <Action className="quiet" working="Opening…" aria-label={`Edit ${recipe.name}`} run={() => edit(recipe)}>Edit</Action>
                  <Menu title={`More actions for ${recipe.name}`} label={<><Icon name="more" /><span className="visually-hidden">More actions for {recipe.name}</span></>}>
                    <MenuItem aria-label={`Rename ${recipe.name}`} onClick={() => setRenaming(recipe.mix_id)}>Rename</MenuItem>
                    <MenuItem aria-label={`Copy ${recipe.name}`} onClick={() => void copy(recipe).catch(() => setProblem(`Couldn’t copy ${recipe.name}. Your mixes are as they were.`))}>Copy</MenuItem>
                    <MenuItem danger aria-label={`Delete ${recipe.name}`} onClick={() => setDeleting(recipe)}><Icon name="trash" /> Delete</MenuItem>
                  </Menu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {deleting && (
        <Dialog title={`Delete ${deleting.name}?`} onClose={() => setDeleting(null)} footer={(
          <>
            <button onClick={() => setDeleting(null)}>Keep it</button>
            <Action className="destructive" working="Deleting…" run={() => remove(deleting)}>Delete mix</Action>
          </>
        )}>
          <p>This deletes the saved mix and every earlier version of it, on every device. It can’t be undone.</p>
          <p className="hint">Your music files are never touched.{deleting.mix_id === currentId ? ' It is your current mix, so nothing will be lined up afterwards.' : ''}</p>
        </Dialog>
      )}
    </section>
  );
}

function RenameMix({ name, onSave, onCancel }: { name: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = value.trim();
    if (!clean || busy) return;
    setBusy(true);
    setProblem('');
    try {
      await onSave(clean);
    } catch (error) {
      // a bare "Request failed (422)" tells nobody what to do next
      const words = (error as Error).message ?? '';
      setProblem(!words || /^Request failed/i.test(words) ? 'Couldn’t save that name. Check your connection and try again.' : words);
      setBusy(false);
    }
  };
  return (
    <form className="rename-draft" onSubmit={submit}>
      <input autoFocus maxLength={MIX_NAME_LIMIT} value={value} onChange={(event) => setValue(event.target.value)} onFocus={(event) => event.target.select()} aria-label="New name" onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }} />
      <button className="small primary" disabled={!value.trim()} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="small quiet" onClick={onCancel}>Cancel</button>
      {problem && <p className="warn" role="alert">{problem}</p>}
    </form>
  );
}
