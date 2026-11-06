import { Icon } from '../ui/Icon';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { del, DraftInfo, DraftList, get, post } from '../api';
import { draftWords, etaRangeWords, length, nth } from '../lib';
import { PageLink } from '../shell/Shell';
import { Action, Problem, Skeleton, Status, StatusKind } from '../ui/controls';
import { ViewProps } from './shared';

type Props = Pick<ViewProps, 'notify' | 'openDraft' | 'playDraft' | 'setView'>;

const CHECK_EVERY_MS = 4000;

function draftStatus(draft: DraftInfo): { kind: StatusKind; words: string } {
  const words = draftWords(draft);
  if (draft.songs === 0 || draft.seams === 0) return { kind: 'planned', words };
  if (draft.rendering) return { kind: 'working', words };
  if (draft.waiting > 0) return { kind: draft.place !== null ? 'queued' : 'planned', words };
  if (draft.failed > 0) return { kind: 'warning', words };
  return { kind: 'ready', words };
}

/** Mixes being worked on. Nothing here touches what's playing until you press Play. */
export function Drafts({ notify, openDraft, playDraft, setView }: Props) {
  const [list, setList] = useState<DraftList | null>(null);
  const [problem, setProblem] = useState('');
  const [couldntLoad, setCouldntLoad] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);

  const refresh = useCallback(() => {
    return get<DraftList>('/drafts')
      .then((next) => {
        setList(next);
        setProblem('');
        setCouldntLoad(false);
      })
      .catch(() => setCouldntLoad(true));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (work: Promise<DraftList>) => {
    try {
      setList(await work);
      setProblem('');
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const startNew = async () => {
    const made = await post<{ id: number }>('/drafts', {});
    openDraft?.(made.id);
  };
  const keepCurrent = async () => {
    const made = await post<{ id: number; name: string }>('/drafts', { copy_current: true });
    await refresh();
    notify(`Saved a copy of your current mix as ${made.name}. What’s playing hasn’t changed.`);
  };
  const prioritize = async (draft: DraftInfo) => {
    const next = await post<DraftList>(`/drafts/${draft.id}/line`);
    setList(next);
    const placed = next.drafts.find((item) => item.id === draft.id);
    if (!placed?.place) notify(`${draft.name} is already ready.`);
    else if (next.current.left > 0 || placed.place > 1) notify(`${draft.name} is in line, and will be ready in ${etaRangeWords(placed.eta ?? undefined)}.`);
    else notify(`Rendering ${draft.name} in the background.`);
  };
  const duplicate = async (draft: DraftInfo) => {
    const made = await post<{ name: string }>(`/drafts/${draft.id}/duplicate`);
    await refresh();
    notify(`Made a copy: ${made.name}.`);
  };
  const remove = async (draft: DraftInfo) => {
    await del(`/drafts/${draft.id}`);
    await refresh();
    notify(`Deleted ${draft.name}.`, async () => {
      await post('/drafts/restore');
      await refresh();
    });
  };

  // nothing to show yet isn't the same as having no drafts
  if (!list) {
    return couldntLoad
      ? <Problem retry={refresh}>Couldn’t load your drafts. They’re still saved.</Problem>
      : <Skeleton variant="cards" label="Loading your drafts" />;
  }
  const { drafts, current, out_of_room: outOfRoom } = list;
  const inLine = drafts.filter((draft) => draft.place !== null);
  return (
    <section className="drafts" aria-label="Your drafts">
      <div className="row wrap drafts-head">
        <h2 className="section-title">Your drafts</h2>
        <Action working="Starting…" run={startNew}>New draft</Action>
        <Action working="Saving…" run={keepCurrent} disabled={current.songs === 0}>Save current mix as a draft</Action>
      </div>
      <p className="hint">
        Build a mix without touching what’s playing. Everything saves as you go.
      </p>
      {problem && <p className="warn" role="alert">{problem}</p>}
      {couldntLoad && <p className="warn" role="status">Can’t check on these right now, so what’s shown may be out of date.</p>}
      {outOfRoom && (
        <p className="warn" role="status">
          Rendering has paused: your stems have reached their storage limit.{' '}
          <PageLink to="/workshop/storage">Change the limit in Workshop</PageLink>
        </p>
      )}
      {inLine.length > 0 && (
        <p className="hint" role="status">
          {current.left > 0
            ? `Your current mix goes first, with ${current.left} seam${current.left === 1 ? '' : 's'} left (${etaRangeWords(current.eta)}).`
            : 'Your current mix is done, so these are rendering in order, ahead of everything else.'}
        </p>
      )}
      {drafts.length === 0 && <div className="empty-state"><h3>A place for your next mix</h3><p>Create a draft or save a copy of your current mix. Editing a draft leaves playback alone.</p></div>}
      {drafts.length > 0 && (
        <ul className="draft-list">
          {drafts.map((draft) => {
            const facts = draftStatus(draft);
            return (
              <li key={draft.id} className={draft.place ? 'draft in-line' : 'draft'}>
                <div className="draft-name">
                  {renaming === draft.id ? (
                    <RenameDraft id={draft.id} name={draft.name} onDone={() => { setRenaming(null); void refresh(); }} />
                  ) : (
                    <PageLink to={`/mixes/drafts/${draft.id}/edit`} className="draft-open"><b>{draft.name}</b></PageLink>
                  )}
                  <span className="soft">
                    {draft.songs > 0 && `${draft.songs} ${draft.songs === 1 ? 'song' : 'songs'}, about ${length(draft.seconds)}. `}
                  </span>
                  <Status kind={facts.kind}>{facts.words}</Status>
                  {draft.seams > 0 && (
                    <div className="draft-progress" role="img" aria-label={`${draft.ready} of ${draft.seams} transitions ready`}>
                      <i style={{ width: `${(100 * draft.ready) / draft.seams}%` }} />
                    </div>
                  )}
                  {draft.place === null && draft.waiting > 0 && draft.seams > 0 && (
                    <span className="soft"> Rendering it would take {etaRangeWords({ seconds: draft.to_render, low: draft.to_render, high: draft.to_render })}.</span>
                  )}
                  {draft.missing > 0 && (
                    <span className="soft"> {draft.missing} {draft.missing === 1 ? 'song has' : 'songs have'} left your library.</span>
                  )}
                </div>
                <div className="row wrap draft-actions">
                  <Action disabled={draft.songs === 0} working="Starting…" title={draft.songs === 0 ? 'Add a song first' : 'Plays this now. What was playing is kept in your drafts.'} aria-label={`Play ${draft.name}`} run={() => playDraft?.(draft.id)}>
                    Play
                  </Action>
                  <button aria-label={`Edit ${draft.name}`} onClick={() => openDraft?.(draft.id)}>Edit</button>
                  {draft.place !== null ? (
                    <span className="line-controls" role="group" aria-label={`${draft.name} in the render line`}>
                      <b className="line-place">{nth(draft.place)} in line</b>
                      <button aria-label={`Move ${draft.name} up the line`} disabled={draft.place === 1} onClick={() => void act(post<DraftList>(`/drafts/${draft.id}/line/move`, { step: -1 }))}><Icon name="up" /></button>
                      <button aria-label={`Move ${draft.name} down the line`} disabled={draft.place === inLine.length} onClick={() => void act(post<DraftList>(`/drafts/${draft.id}/line/move`, { step: 1 }))}><Icon name="down" /></button>
                      <button aria-label={`Take ${draft.name} out of the line`} onClick={() => void act(del<DraftList>(`/drafts/${draft.id}/line`))}>Out of line</button>
                    </span>
                  ) : (
                    draft.seams > 0 && draft.waiting > 0 && (
                      <Action title="Renders in the background, right after your current mix" aria-label={`Prioritize ${draft.name}`} run={() => prioritize(draft)}>
                        Prioritize
                      </Action>
                    )
                  )}
                  <button aria-label={`Rename ${draft.name}`} onClick={() => setRenaming(draft.id)}>Rename</button>
                  <Action aria-label={`Copy ${draft.name}`} run={() => duplicate(draft)}>Copy</Action>
                  <Action className="destructive" aria-label={`Delete ${draft.name}`} run={() => remove(draft)}><Icon name="close" /></Action>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Keeps a name while it's being typed, and saves it when you're done. */
export function RenameDraft({ id, name, onDone }: { id: number; name: string; onDone: (name: string) => void }) {
  const [text, setText] = useState(name);
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const answer = await post<{ name: string }>(`/drafts/${id}/name`, { name: text });
    onDone(answer.name);
  };
  return (
    <form className="row" onSubmit={(event) => void save(event)}>
      <input
        autoFocus
        maxLength={60}
        value={text}
        aria-label="Name this draft"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone(name);
        }}
      />
      <button className="primary">Save name</button>
      <button type="button" onClick={() => onDone(name)}>Cancel</button>
    </form>
  );
}
