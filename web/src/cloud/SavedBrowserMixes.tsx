import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { MixData } from '../api';
import { navigate } from '../router';
import { Action, Dialog, Menu, Skeleton, Status } from '../ui/controls';
import { countOf, relativeTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { MenuItem } from '../ui/primitives';
import type { ViewProps } from '../views/shared';
import { EMPTY_MIX } from './localFirstRequest';
import type { RecipeStore, RecipeSummary } from './recipeStore';
import { flagOn } from '../flags';
import { MIX_OUTBOX_EVENT, takeOutboxNotices, WAITING_TO_SYNC } from './outbox';

/** My Mixes' saved browser mixes, laid out as local mode lays out its drafts (views/Drafts.tsx):
 * a section with its own action, a line on what saving means here, and a row per mix with Edit,
 * Play and a menu (Rename, Copy, Delete). A browser mix is a recipe on the account (ADR-0458), so
 * it opens on any device holding the same music; the editor and player work on the current mix,
 * so Edit and Play first make the chosen mix current. */
export function SavedBrowserMixes({ workspaceId, recipes, request, setMixData, refreshStatus, player, notify }: {
  workspaceId: string;
  recipes: RecipeStore;
  request: NonNullable<ViewProps['request']>;
  setMixData: ViewProps['setMixData'];
  refreshStatus: ViewProps['refreshStatus'];
  player: ViewProps['player'];
  notify: ViewProps['notify'];
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
    const made = await recipes.duplicate(recipe.mix_id);
    await load();
    notify(`Saved a copy: ${made.name}.`);
  };
  const saveCurrent = async () => {
    const current = recipes.current();
    if (!current) return;
    const made = await recipes.duplicate(current);
    await load();
    notify(`Saved a copy: ${made.name}.`);
  };
  const rename = async (recipe: RecipeSummary, name: string) => {
    const fresh = await recipes.read(recipe.mix_id);
    await recipes.edit(recipe.mix_id, fresh.revision, { name });
    setRenaming(null);
    if (recipes.current() === recipe.mix_id) setMixData(await request<MixData>('/mix'));
    await load();
  };
  const remove = async (recipe: RecipeSummary) => {
    await recipes.remove(recipe.mix_id);
    if (recipes.current() === recipe.mix_id) {
      recipes.setCurrent(null);
      setMixData(EMPTY_MIX);
      refreshStatus();
    }
    setDeleting(null);
    await load();
    notify(`Deleted ${recipe.name}.`);
  };

  const currentId = recipes.current();
  const now = Date.now() / 1000;
  return (
    <section className="drafts" aria-labelledby="saved-browser-mixes">
      <div className="row wrap drafts-head">
        <h2 className="section-title" id="saved-browser-mixes">Your saved mixes</h2>
        <div className="row wrap">
          <Action working="Saving…" run={saveCurrent} disabled={!currentId}>Save a copy of the current mix</Action>
        </div>
      </div>
      <p className="hint">
        Every mix you make here is saved to your account, so it opens on any device that has the same music. Editing or playing one makes it your current mix; the others stay as they are.
      </p>
      {outbox && synced && <p className="hint" role="status">{synced} <button onClick={() => setSynced('')}>Dismiss</button></p>}
      {problem && <p className="warn" role="alert">{problem} <button onClick={() => void load()}>Try again</button></p>}
      {list === null && !problem && <Skeleton variant="rows" lines={2} label="Loading saved mixes" />}
      {list?.length === 0 && (
        <div className="empty-state">
          <h3>A place for your next mix</h3>
          <p>Make a mix from your songs, and it’s saved here as you go.</p>
          <button className="primary" onClick={() => navigate('/mixes')}>Make a Mix</button>
        </div>
      )}
      {!!list?.length && (
        <ul className="draft-list density">
          {list.map((recipe) => {
            const current = recipe.mix_id === currentId;
            return (
              <li className="draft" key={recipe.mix_id}>
                <div className="draft-name">
                  {renaming === recipe.mix_id ? (
                    <RenameMix name={recipe.name} onCancel={() => setRenaming(null)} onSave={(name) => rename(recipe, name)} />
                  ) : (
                    <b className="draft-open">{recipe.name}</b>
                  )}
                  <span className="soft">{countOf(recipe.songs, 'song')}. {outbox && recipe.pending ? 'Saved on this device; it goes to your account when the connection is back.' : `Saved ${relativeTime(now - recipe.updated_at)}.`}</span>
                  {current && <Status kind="ready">Your current mix</Status>}
                  {outbox && recipe.pending && <Status kind="queued">{WAITING_TO_SYNC}</Status>}
                </div>
                <div className="row wrap draft-actions">
                  <Action className="draft-edit" working="Opening…" aria-label={`Edit ${recipe.name}`} run={() => edit(recipe)}>Edit</Action>
                  <Action working="Starting…" aria-label={`Play ${recipe.name}`} run={() => play(recipe)}>Play</Action>
                  <Menu title={`More actions for ${recipe.name}`} label={<><Icon name="more" /><span className="visually-hidden">More actions for {recipe.name}</span></>}>
                    <MenuItem aria-label={`Rename ${recipe.name}`} onClick={() => setRenaming(recipe.mix_id)}>Rename</MenuItem>
                    <MenuItem aria-label={`Copy ${recipe.name}`} onClick={() => void copy(recipe).catch((error: Error) => setProblem(error.message))}>Copy</MenuItem>
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
      setProblem((error as Error).message || 'Couldn’t rename it.');
      setBusy(false);
    }
  };
  return (
    <form className="row" onSubmit={submit}>
      <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} aria-label="New name" onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }} />
      <button className="primary" disabled={!value.trim()} aria-busy={busy || undefined}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      {problem && <p className="warn" role="alert">{problem}</p>}
    </form>
  );
}
