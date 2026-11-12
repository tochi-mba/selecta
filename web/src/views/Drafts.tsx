import { Icon } from '../ui/Icon';
import { FormEvent, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { del, DraftInfo, DraftList, get, post } from '../api';
import { useFlags } from '../flags';
import { etaRangeWords, length, nth } from '../lib';
import { PageLink } from '../shell/PageLink';
import { keepUnchangedDrafts } from '../state/keepUnchanged';
import { draftReadiness } from '../state/readiness';
import { Action, Dialog, Menu, Problem, Skeleton, Status } from '../ui/controls';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { MenuItem } from '../ui/primitives';
import { MixSignature } from '../ui/MusicObjects';
import { ViewProps } from './shared';

type Props = Pick<ViewProps, 'notify' | 'openDraft' | 'playDraft' | 'setView'> & {
  /** SF-0204-02: My Mixes has one primary action, and the drafts own it (the first draft's Edit, or
   * starting the first draft) unless the page leads with something else. */
  lead?: boolean;
};

const CHECK_EVERY_MS = 4000;

/** CI-0179-04: one segment per transition, from the server's own ready, failed and waiting counts, so
 * a draft never shows an invented overall percentage and a failure is never hidden inside "not ready
 * yet". Anything the server doesn't count as one of those three stays a plain, unclaimed segment. */
export function SeamSegments({ draft }: { draft: Pick<DraftInfo, 'seams' | 'ready' | 'failed' | 'waiting'> }) {
  const count = (value: number) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  const seams = count(draft.seams);
  const ready = Math.min(count(draft.ready), seams);
  const failed = Math.min(count(draft.failed), seams - ready);
  const waiting = Math.min(count(draft.waiting), seams - ready - failed);
  const other = seams - ready - failed - waiting;
  const said = [
    `${ready} of ${seams} transitions ready`,
    failed && `${failed} couldn’t be made`,
    waiting && `${waiting} waiting`,
    other && `${other} not started`,
  ].filter(Boolean).join(', ');
  const kinds = [
    ...Array<string>(ready).fill('ready'),
    ...Array<string>(failed).fill('failed'),
    ...Array<string>(waiting).fill('waiting'),
    ...Array<string>(other).fill('other'),
  ];
  return (
    <div className="draft-progress draft-seams" role="img" aria-label={said} title={said}>
      {kinds.map((kind, index) => <i key={index} className={kind} />)}
    </div>
  );
}

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
        The order SelectaDJ prepares audio in, in the background. It doesn’t change what’s playing or the order of songs in any mix.
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
              <button data-line-move={`${draft.id}:-1`} aria-label={`Move ${draft.name} up the line`} title={`Move ${draft.name} up the line`} disabled={draft.place === 1} onClick={() => onMove(draft, -1)}><Icon name="up" /></button>
              <button data-line-move={`${draft.id}:1`} aria-label={`Move ${draft.name} down the line`} title={`Move ${draft.name} down the line`} disabled={draft.place === inLine.length} onClick={() => onMove(draft, 1)}><Icon name="down" /></button>
              <button aria-label={`Take ${draft.name} out of the line`} onClick={() => onLeave(draft)}>Out of line</button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What a draft's row can ask for. One object for the whole list, whose functions never change, so a
 * row that's handed the same draft as last time doesn't redraw. */
type RowActions = {
  open: (id: number) => void;
  play: (id: number) => Promise<void> | void;
  rename: (id: number) => void;
  renamed: () => void;
  duplicate: (draft: DraftInfo) => void;
  prioritize: (draft: DraftInfo) => void;
  outOfLine: (draft: DraftInfo) => void;
  askDelete: (draft: DraftInfo) => void;
};

/** One draft in the list. Memoised: a poll or a change to one draft redraws only the rows whose
 * draft really changed (see keepUnchangedDrafts), not all of them. */
const DraftRow = memo(function DraftRow({ draft, twin, failure, renaming, editor, line, primary, actions }: {
  draft: DraftInfo;
  /** another draft has the same name, so this one says its number */
  twin: boolean;
  failure?: string;
  renaming: boolean;
  editor: boolean;
  line: boolean;
  /** SF-0204-02: this row's Edit is the page's one primary action */
  primary: boolean;
  actions: RowActions;
}) {
  const facts = draftReadiness(draft);
  const who = twin ? `${draft.name} (draft ${draft.id})` : draft.name;
  const signature = useMemo(() => (draft.song_ids ?? []).map((song_id) => ({ song_id })), [draft.song_ids]);
  return (
    <li className={draft.place ? 'draft in-line' : 'draft'}>
      <div className="draft-name">
        {renaming ? (
          <RenameDraft id={draft.id} name={draft.name} onDone={actions.renamed} />
        ) : (
          editor
            ? <PageLink id={`draft-${draft.id}`} to={`/mixes/drafts/${draft.id}/edit`} className="draft-open"><b>{draft.name}</b></PageLink>
            : <b id={`draft-${draft.id}`} className="draft-open">{draft.name}</b>
        )}
        {/* UF-0379-01/07: drafts that share a name are told apart by their exact draft number */}
        {twin && <span className="soft draft-number"> Draft {draft.id}</span>}
        {signature.length ? <MixSignature items={signature} compact /> : null}
        <span className="soft">
          {draft.songs > 0 && `${draft.songs} ${draft.songs === 1 ? 'song' : 'songs'}, about ${length(draft.seconds)}. `}
          Saved.
        </span>
        <Status kind={facts.kind}>{facts.words}</Status>
        {line && draft.place !== null && <span className="soft"> {nth(draft.place)} in the render line.</span>}
        {draft.seams > 0 && (
          <SeamSegments draft={draft} />
        )}
        {line && draft.place === null && draft.waiting > 0 && draft.seams > 0 && (
          <span className="soft"> Rendering it would take {etaRangeWords({ seconds: draft.to_render, low: draft.to_render, high: draft.to_render })}.</span>
        )}
        {draft.missing > 0 && (
          <Status kind="warning">{draft.missing} {draft.missing === 1 ? 'song has' : 'songs have'} left your library.</Status>
        )}
        {failure && <p className="warn" role="alert">{failure}</p>}
      </div>
      <div className="row wrap draft-actions">
        {editor && <button className={primary ? 'draft-edit primary' : 'draft-edit'} aria-label={`Edit ${who}`} onClick={() => actions.open(draft.id)}>Edit</button>}
        <Action disabled={draft.songs === 0} working="Starting…" title={draft.songs === 0 ? 'Add a song first' : 'Plays this now. What was playing is kept in your drafts.'} aria-label={`Play ${who}`} run={() => actions.play(draft.id)}>
          Play
        </Action>
        <Menu title={`More actions for ${who}`} label={<><Icon name="more" /><span className="visually-hidden">More actions for {who}</span></>}>
          <MenuItem aria-label={`Rename ${who}`} onClick={() => actions.rename(draft.id)}>Rename</MenuItem>
          <MenuItem aria-label={`Copy ${who}`} onClick={() => actions.duplicate(draft)}>Copy</MenuItem>
          {line && draft.place === null && draft.seams > 0 && draft.waiting > 0 && (
            <MenuItem aria-label={`Prioritize ${who}`} title="Renders in the background, right after your current mix" onClick={() => actions.prioritize(draft)}>Prioritize</MenuItem>
          )}
          {line && draft.place !== null && (
            <MenuItem aria-label={`Out of line: ${who}`} onClick={() => actions.outOfLine(draft)}>Out of line</MenuItem>
          )}
          <MenuItem danger aria-label={`Delete ${who}`} onClick={() => actions.askDelete(draft)}><Icon name="trash" /> Delete</MenuItem>
        </Menu>
      </div>
    </li>
  );
});

/** Mixes being worked on. Nothing here touches what's playing until you press Play. Saved and able to
 * be heard are different things, so a draft says each of them. */
export function Drafts({ notify, openDraft, playDraft, lead = true }: Props) {
  const [list, setList] = useState<DraftList | null>(null);
  const [problem, setProblem] = useState('');
  const [failures, setFailures] = useState<Record<number, string>>({});
  const [couldntLoad, setCouldntLoad] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<DraftInfo | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name' | 'readiness'>('recent');
  const [visibleCount, setVisibleCount] = useState(40);
  const heading = useRef<HTMLHeadingElement>(null);
  const wasRenaming = useRef<number | null>(null);
  const readVersion = useRef(0);
  const pendingWrites = useRef(0);
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const focusAfterMove = useRef<{ id: number; step: number } | null>(null);
  // r8a: an answer that changes nothing keeps the drafts already shown, so their rows don't redraw
  const show = useCallback((next: DraftList) => setList((before) => keepUnchangedDrafts(before, next)), []);
  // The server's reordered list must be committed to the DOM before focus
  // moves to the draft's surviving enabled control.
  useLayoutEffect(() => {
    const pending = focusAfterMove.current;
    if (!pending) return;
    const same = document.querySelector<HTMLButtonElement>(`[data-line-move="${pending.id}:${pending.step}"]`);
    const other = document.querySelector<HTMLButtonElement>(`[data-line-move="${pending.id}:${-pending.step}"]`);
    const target = same && !same.disabled ? same : other && !other.disabled ? other : null;
    if (!target) return;
    focusAfterMove.current = null;
    target.focus({ preventScroll: true });
  }, [list]);

  const refresh = useCallback(() => {
    const version = ++readVersion.current;
    if (pendingWrites.current) return Promise.resolve();
    return get<DraftList>('/drafts')
      .then((next) => {
        if (version !== readVersion.current || pendingWrites.current) return;
        show(next);
        setProblem('');
        setCouldntLoad(false);
      })
      .catch(() => {
        if (version === readVersion.current && !pendingWrites.current) setCouldntLoad(true);
      });
  }, [show]);

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
      if (!(draft.id in before)) return before;
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
  const act = async (send: () => Promise<DraftList>): Promise<boolean> => {
    try {
      show(await write(send));
      setProblem('');
      return true;
    } catch (error) {
      setProblem((error as Error).message);
      return false;
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
    show(next);
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
    const removedLink = document.getElementById(`draft-${draft.id}`);
    const removedRow = removedLink?.closest('li');
    const focusAfter = (removedRow?.nextElementSibling ?? removedRow?.previousElementSibling)
      ?.querySelector<HTMLElement>('[id^="draft-"]') ?? heading.current;
    const scrollBefore = window.scrollY;
    await write(() => del(`/drafts/${draft.id}`));
    setList((before) => before ? { ...before, drafts: before.drafts.filter((item) => item.id !== draft.id) } : before);
    // Removing one card from a long, sorted or filtered list must not throw a
    // keyboard user back to the top or move the viewport. Stable IDs let the
    // nearest surviving card receive focus even when its visual position has
    // changed since the request began.
    window.requestAnimationFrame(() => {
      (focusAfter?.isConnected ? focusAfter : heading.current)?.focus({ preventScroll: true });
      if (window.scrollY !== scrollBefore) window.scrollTo({ top: scrollBefore });
    });
    // by its id, so it's this draft that comes back, whatever else has been deleted since
    notify(`Deleted ${draft.name}.`, async () => {
      await post(`/drafts/restore?id=${draft.id}`);
      await refresh();
    });
  });

  // The rows get stable functions that call whatever this render's handlers are.
  const latest = useRef({ openDraft, playDraft, prioritize, duplicate, act });
  latest.current = { openDraft, playDraft, prioritize, duplicate, act };
  const actions = useMemo<RowActions>(() => ({
    open: (id) => latest.current.openDraft?.(id),
    play: (id) => latest.current.playDraft?.(id),
    rename: (id) => setRenaming(id),
    renamed: () => { setRenaming(null); void refresh(); },
    duplicate: (draft) => void latest.current.duplicate(draft),
    prioritize: (draft) => void latest.current.prioritize(draft),
    outOfLine: (draft) => void latest.current.act(() => del<DraftList>(`/drafts/${draft.id}/line`)),
    askDelete: (draft) => setDeleting(draft),
  }), [refresh]);

  const on = useFlags();
  const line = on('render_line');
  const editor = on('editor');
  const all = list?.drafts;
  const cleanQuery = query.trim().toLocaleLowerCase();
  // r8a: filtering, sorting and counting names happen when the drafts, search or sort change, not on
  // every redraw of the page
  const shownDrafts = useMemo(() => (all ?? [])
    .filter((draft) => !cleanQuery || draft.name.toLocaleLowerCase().includes(cleanQuery))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      if (sort === 'readiness') {
        const readinessA = a.seams ? a.ready / a.seams : a.songs ? 1 : 0;
        const readinessB = b.seams ? b.ready / b.seams : b.songs ? 1 : 0;
        return readinessB - readinessA || b.id - a.id;
      }
      return b.id - a.id;
    }), [all, cleanQuery, sort]);
  const sameName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const draft of all ?? []) counts.set(draft.name, (counts.get(draft.name) ?? 0) + 1);
    return counts;
  }, [all]);
  const inLine = useMemo(() => (all ?? []).filter((draft) => draft.place !== null), [all]);
  // nothing to show yet isn't the same as having no drafts
  if (!list) {
    return couldntLoad
      ? <Problem retry={refresh}>Couldn’t load your drafts. They’re still saved.</Problem>
      : <Skeleton variant="cards" label="Loading your drafts" />;
  }
  const { drafts, current, out_of_room: outOfRoom } = list;
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
              <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(40); }} placeholder="Search by name" />
            </label>
            <label>
              <span>Sort drafts</span>
              <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setVisibleCount(40); }}>
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
            <Action className={lead ? 'primary' : undefined} working="Starting…" run={startNew}>Start your first draft</Action>
          </div>
        )}
        {drafts.length > 0 && shownDrafts.length === 0 && (
          <div className="empty-state">
            <h3>No drafts match “{query.trim()}”.</h3>
            <button onClick={() => { setQuery(''); setVisibleCount(40); }}>Clear search</button>
          </div>
        )}
        {shownDrafts.length > 0 && (
          <ul className={shownDrafts.length > 20 ? 'draft-list density long' : 'draft-list density'}>
            {shownDrafts.slice(0, visibleCount).map((draft, index) => (
              <DraftRow key={draft.id} draft={draft} twin={(sameName.get(draft.name) ?? 0) > 1}
                failure={failures[draft.id]} renaming={renaming === draft.id} editor={editor} line={line}
                primary={lead && index === 0} actions={actions} />
            ))}
          </ul>
        )}
        {shownDrafts.length > visibleCount && (
          <button
            className="drafts-show-more"
            onClick={() => setVisibleCount((count) => count + 40)}
          >
            Show 40 more drafts ({shownDrafts.length - visibleCount} remaining)
          </button>
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
          <p>This removes only the saved draft {deleting.name}{line ? ' and its place in the render line' : ''}. Your current mix and original music files are untouched.</p>
          <p className="hint">You can undo this from the notification if the restore point is still available.</p>
          {failures[deleting.id] && <p className="warn" role="alert">{failures[deleting.id]}</p>}
        </Dialog>
      )}
      {line && inLine.length > 0 && (
        <RenderLine
          inLine={inLine}
          current={current}
          onMove={(draft, step) => {
            focusAfterMove.current = { id: draft.id, step };
            void act(() => post<DraftList>(`/drafts/${draft.id}/line/move`, { step })).then((succeeded) => {
              if (!succeeded) focusAfterMove.current = null;
            });
          }}
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
  const problemId = useId();
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
        aria-describedby={problem ? problemId : undefined}
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
      {problem && <p className="warn" role="alert" id={problemId}>{problem}</p>}
    </form>
  );
}
