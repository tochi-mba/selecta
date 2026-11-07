import { Icon } from '../ui/Icon';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { del, DraftInfo, DraftList, get, post } from '../api';
import { etaRangeWords, length, nth } from '../lib';
import { PageLink } from '../shell/PageLink';
import { draftReadiness } from '../state/readiness';
import { Action, Dialog, Menu, Problem, Skeleton, Status } from '../ui/controls';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { MenuItem } from '../ui/primitives';
import { ViewProps } from './shared';

type Props = Pick<ViewProps, 'notify' | 'openDraft' | 'playDraft' | 'setView'>;

const CHECK_EVERY_MS = 4000;

/** The order audio gets prepared in, which is separate from what's playing and from the order of the
 * songs in any mix. Changing it only changes what's ready first. */
function RenderLine({ inLine, current, onMove, onLeave }: {
  inLine: DraftInfo[];
  current: DraftList['current'];
  onMove: (draft: DraftInfo, step: number) => void;
  onLeave: (draft: DraftInfo) => void;
}) {
  return (
    <section className="render-line" aria-label="Render line">
      <h2 className="section-title">Render line</h2>
      <p className="hint">
        The order Selecta prepares audio in, in the background. It doesn’t change what’s playing or the order of songs in any mix.
      </p>
      <p className="hint" role="status">
        {current.left > 0
          ? `Your current mix goes first, with ${current.left} seam${current.left === 1 ? '' : 's'} left (${etaRangeWords(current.eta)}).`
          : 'Your current mix is done, so these are rendering in order, ahead of everything else.'}
      </p>
      <ol className="line-list">
        {[...inLine].sort((a, b) => (a.place ?? 0) - (b.place ?? 0)).map((draft) => (
          <li key={draft.id} className="line-controls" role="group" aria-label={`${draft.name} in the render line`}>
            <b className="line-place">{nth(draft.place ?? 0)} in line</b>
            <span className="line-name">{draft.name}</span>
            <span className="line-buttons">
              <button aria-label={`Move ${draft.name} up the line`} disabled={draft.place === 1} onClick={() => onMove(draft, -1)}><Icon name="up" /></button>
              <button aria-label={`Move ${draft.name} down the line`} disabled={draft.place === inLine.length} onClick={() => onMove(draft, 1)}><Icon name="down" /></button>
              <button aria-label={`Take ${draft.name} out of the line`} onClick={() => onLeave(draft)}>Out of line</button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Mixes being worked on. Nothing here touches what's playing until you press Play. Saved and able to
 * be heard are different things, so a draft says each of them. */
export function Drafts({ notify, openDraft, playDraft }: Props) {
  const [list, setList] = useState<DraftList | null>(null);
  const [problem, setProblem] = useState('');
  const [failures, setFailures] = useState<Record<number, string>>({});
  const [couldntLoad, setCouldntLoad] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<DraftInfo | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name' | 'readiness'>('recent');
  const heading = useRef<HTMLHeadingElement>(null);
  const wasRenaming = useRef<number | null>(null);
  const readVersion = useRef(0);
  const pendingWrites = useRef(0);
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(() => {
    const version = ++readVersion.current;
    if (pendingWrites.current) return Promise.resolve();
    return get<DraftList>('/drafts')
      .then((next) => {
        if (version !== readVersion.current || pendingWrites.current) return;
        setList(next);
        setProblem('');
        setCouldntLoad(false);
      })
      .catch(() => {
        if (version === readVersion.current && !pendingWrites.current) setCouldntLoad(true);
      });
  }, []);

  // A poll that began before a mutation must never replace its acknowledged result.
  // Serialize changes to the render line so their server snapshots stay in intent order.
  const write = async <T,>(send: () => Promise<T>): Promise<T> => {
    pendingWrites.current += 1;
    readVersion.current += 1;
    const request = writeQueue.current.then(send);
    writeQueue.current = request.catch(() => undefined);
    try {
      return await request;
    } finally {
      pendingWrites.current -= 1;
      readVersion.current += 1;
    }
  };

  useEffect(() => { void refresh(); }, [refresh]);
  useVisiblePoll(refresh, CHECK_EVERY_MS);

  // once a name has been saved or left alone, focus goes back to that draft
  useEffect(() => {
    if (renaming === null && wasRenaming.current !== null) document.getElementById(`draft-${wasRenaming.current}`)?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  /** Something done to one draft. If it fails, that draft says so and what's saved hasn't changed. */
  const onDraft = async (draft: DraftInfo, doing: string, work: () => Promise<void>): Promise<boolean> => {
    setFailures((before) => {
      const { [draft.id]: _gone, ...rest } = before;
      return rest;
    });
    try {
      await work();
      return true;
    } catch (error) {
      setFailures((before) => ({ ...before, [draft.id]: `Couldn’t ${doing}: ${(error as Error).message || 'try again.'}` }));
      return false;
    }
  };
  const act = async (send: () => Promise<DraftList>) => {
    try {
      setList(await write(send));
      setProblem('');
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const startNew = async () => {
    const made = await write(() => post<{ id: number }>('/drafts', {}));
    openDraft?.(made.id);
  };
  const keepCurrent = async () => {
    const made = await write(() => post<{ id: number; name: string }>('/drafts', { copy_current: true }));
    await refresh();
    notify(`Saved a copy of your current mix as ${made.name}. What’s playing hasn’t changed.`);
  };
  const prioritize = (draft: DraftInfo) => onDraft(draft, 'put that in line', async () => {
    const next = await write(() => post<DraftList>(`/drafts/${draft.id}/line`));
    setList(next);
    const placed = next.drafts.find((item) => item.id === draft.id);
    if (!placed?.place) notify(`${draft.name} is already ready.`);
    else if (next.current.left > 0 || placed.place > 1) notify(`${draft.name} is in line, and will be ready in ${etaRangeWords(placed.eta ?? undefined)}.`);
    else notify(`Rendering ${draft.name} in the background.`);
  });
  const duplicate = (draft: DraftInfo) => onDraft(draft, 'copy that', async () => {
    const made = await write(() => post<{ name: string }>(`/drafts/${draft.id}/duplicate`));
    await refresh();
    notify(`Made a copy: ${made.name}.`);
  });
  const remove = (draft: DraftInfo) => onDraft(draft, 'delete that', async () => {
    await write(() => del(`/drafts/${draft.id}`));
    setList((before) => before ? { ...before, drafts: before.drafts.filter((item) => item.id !== draft.id) } : before);
    heading.current?.focus();
    // by its id, so it's this draft that comes back, whatever else has been deleted since
    notify(`Deleted ${draft.name}.`, async () => {
      await post(`/drafts/restore?id=${draft.id}`);
      await refresh();
    });
  });

  // nothing to show yet isn't the same as having no drafts
  if (!list) {
    return couldntLoad
      ? <Problem retry={refresh}>Couldn’t load your drafts. They’re still saved.</Problem>
      : <Skeleton variant="cards" label="Loading your drafts" />;
  }
  const { drafts, current, out_of_room: outOfRoom } = list;
  const inLine = drafts.filter((draft) => draft.place !== null);
  const cleanQuery = query.trim().toLocaleLowerCase();
  const shownDrafts = drafts
    .filter((draft) => !cleanQuery || draft.name.toLocaleLowerCase().includes(cleanQuery))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      if (sort === 'readiness') {
        const readinessA = a.seams ? a.ready / a.seams : a.songs ? 1 : 0;
        const readinessB = b.seams ? b.ready / b.seams : b.songs ? 1 : 0;
        return readinessB - readinessA || b.id - a.id;
      }
      return b.id - a.id;
    });
  return (
    <>
      <section className="drafts" aria-label="Your drafts">
        <div className="row wrap drafts-head">
          <h2 className="section-title" ref={heading} tabIndex={-1}>Your drafts</h2>
          <div className="row wrap">
            <Action working="Starting…" run={startNew}>New draft</Action>
            <Action working="Saving…" run={keepCurrent} disabled={current.songs === 0}>Save current mix as a draft</Action>
          </div>
        </div>
        <p className="hint">
          Build a mix without touching what’s playing. Everything saves as you go. Playing a draft makes it your current mix, and what was playing becomes a draft, so nothing is lost.
        </p>
        {drafts.length > 4 && (
          <div className="draft-tools">
            <label>
              <span>Find a draft</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" />
            </label>
            <label>
              <span>Sort drafts</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="recent">Newest first</option>
                <option value="name">Name</option>
                <option value="readiness">Most ready</option>
              </select>
            </label>
          </div>
        )}
        {problem && <p className="warn" role="alert">{problem}</p>}
        {couldntLoad && <p className="warn" role="status">Can’t check on these right now, so what’s shown may be out of date.</p>}
        {outOfRoom && (
          <p className="warn" role="status">
            Rendering has paused: your stems have reached their storage limit.{' '}
            <PageLink to="/workshop/storage">Change the limit in Workspace</PageLink>
          </p>
        )}
        {drafts.length === 0 && (
          <div className="empty-state">
            <h3>A place for your next mix</h3>
            <p>Create a draft, or save a copy of your current mix. Editing a draft leaves playback alone.</p>
          </div>
        )}
        {drafts.length > 0 && shownDrafts.length === 0 && (
          <div className="empty-state">
            <h3>No drafts match “{query.trim()}”.</h3>
            <button onClick={() => setQuery('')}>Clear search</button>
          </div>
        )}
        {shownDrafts.length > 0 && (
          <ul className="draft-list density">
            {shownDrafts.map((draft) => {
              const facts = draftReadiness(draft);
              const failure = failures[draft.id];
              return (
                <li key={draft.id} className={draft.place ? 'draft in-line' : 'draft'}>
                  <div className="draft-name">
                    {renaming === draft.id ? (
                      <RenameDraft id={draft.id} name={draft.name} onDone={() => { setRenaming(null); void refresh(); }} />
                    ) : (
                      <PageLink id={`draft-${draft.id}`} to={`/mixes/drafts/${draft.id}/edit`} className="draft-open"><b>{draft.name}</b></PageLink>
                    )}
                    <span className="soft">
                      {draft.songs > 0 && `${draft.songs} ${draft.songs === 1 ? 'song' : 'songs'}, about ${length(draft.seconds)}. `}
                      Saved.
                    </span>
                    <Status kind={facts.kind}>{facts.words}</Status>
                    {draft.place !== null && <span className="soft"> {nth(draft.place)} in the render line.</span>}
                    {draft.seams > 0 && (
                      <div className="draft-progress" role="img" aria-label={`${draft.ready} of ${draft.seams} transitions ready`}>
                        <i style={{ width: `${(100 * draft.ready) / draft.seams}%` }} />
                      </div>
                    )}
                    {draft.place === null && draft.waiting > 0 && draft.seams > 0 && (
                      <span className="soft"> Rendering it would take {etaRangeWords({ seconds: draft.to_render, low: draft.to_render, high: draft.to_render })}.</span>
                    )}
                    {draft.missing > 0 && (
                      <Status kind="warning">{draft.missing} {draft.missing === 1 ? 'song has' : 'songs have'} left your library.</Status>
                    )}
                    {failure && <p className="warn" role="alert">{failure}</p>}
                  </div>
                  <div className="row wrap draft-actions">
                    <button className="primary" aria-label={`Edit ${draft.name}`} onClick={() => openDraft?.(draft.id)}>Edit</button>
                    <Action disabled={draft.songs === 0} working="Starting…" title={draft.songs === 0 ? 'Add a song first' : 'Plays this now. What was playing is kept in your drafts.'} aria-label={`Play ${draft.name}`} run={() => playDraft?.(draft.id)}>
                      Play
                    </Action>
                    <Menu label={<><Icon name="more" /><span className="visually-hidden">More actions for {draft.name}</span></>}>
                      <MenuItem aria-label={`Rename ${draft.name}`} onClick={() => setRenaming(draft.id)}>Rename</MenuItem>
                      <MenuItem aria-label={`Copy ${draft.name}`} onClick={() => void duplicate(draft)}>Copy</MenuItem>
                      {draft.place === null && draft.seams > 0 && draft.waiting > 0 && (
                        <MenuItem aria-label={`Prioritize ${draft.name}`} title="Renders in the background, right after your current mix" onClick={() => void prioritize(draft)}>Prioritize</MenuItem>
                      )}
                      {draft.place !== null && (
                        <MenuItem aria-label={`Out of line: ${draft.name}`} onClick={() => void act(() => del<DraftList>(`/drafts/${draft.id}/line`))}>Out of line</MenuItem>
                      )}
                      <MenuItem danger aria-label={`Delete ${draft.name}`} onClick={() => setDeleting(draft)}><Icon name="trash" /> Delete</MenuItem>
                    </Menu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {deleting && (
        <Dialog
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(null)}
          footer={(
            <>
              <button onClick={() => setDeleting(null)}>Keep draft</button>
              <Action className="destructive" working="Deleting…" run={async () => {
                const draft = deleting;
                if (await remove(draft)) setDeleting(null);
              }}>Delete draft</Action>
            </>
          )}
        >
          <p>This removes only the saved draft {deleting.name} and its place in the render line. Your current mix and original music files are untouched.</p>
          <p className="hint">You can undo this from the notification if the restore point is still available.</p>
          {failures[deleting.id] && <p className="warn" role="alert">{failures[deleting.id]}</p>}
        </Dialog>
      )}
      {inLine.length > 0 && (
        <RenderLine
          inLine={inLine}
          current={current}
          onMove={(draft, step) => void act(() => post<DraftList>(`/drafts/${draft.id}/line/move`, { step }))}
          onLeave={(draft) => void act(() => del<DraftList>(`/drafts/${draft.id}/line`))}
        />
      )}
    </>
  );
}

/** Keeps a name while it's being typed, and saves it when you're done. If saving fails the typing stays
 * right there, with the reason. */
export function RenameDraft({ id, name, onDone }: { id: number; name: string; onDone: (name: string) => void }) {
  const [text, setText] = useState(name);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    setProblem('');
    try {
      const answer = await post<{ name: string }>(`/drafts/${id}/name`, { name: text });
      onDone(answer.name);
    } catch (error) {
      setProblem((error as Error).message || 'Couldn’t save that name.');
      setSaving(false);
    }
  };
  return (
    <form className="row wrap rename-draft" onSubmit={(event) => void save(event)}>
      <input
        autoFocus
        maxLength={60}
        value={text}
        aria-label="Name this draft"
        aria-invalid={problem ? true : undefined}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onDone(name);
          }
        }}
      />
      <button className="primary" disabled={saving} aria-busy={saving || undefined}>{saving ? 'Saving…' : 'Save name'}</button>
      <button type="button" onClick={() => onDone(name)}>Cancel</button>
      {problem && <p className="warn" role="alert">{problem}</p>}
    </form>
  );
}
