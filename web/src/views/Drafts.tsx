import { FormEvent, useCallback, useEffect, useState } from 'react';
import { del, DraftInfo, DraftList, get, post } from '../api';
import { draftWords, etaRangeWords, length, nth } from '../lib';
import { ViewProps } from './shared';

type Props = Pick<ViewProps, 'notify' | 'openDraft' | 'playDraft' | 'setView'>;

const CHECK_EVERY_MS = 4000;

/** Mixes being worked on. Nothing here touches what's playing until you press Play. */
export function Drafts({ notify, openDraft, playDraft, setView }: Props) {
  const [list, setList] = useState<DraftList | null>(null);
  const [problem, setProblem] = useState('');

  const refresh = useCallback(() => {
    get<DraftList>('/drafts')
      .then((next) => {
        setList(next);
        setProblem('');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, CHECK_EVERY_MS);
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
    refresh();
    notify(`Made a copy: ${made.name}.`);
  };
  const remove = async (draft: DraftInfo) => {
    await del(`/drafts/${draft.id}`);
    refresh();
    notify(`Deleted ${draft.name}.`, async () => {
      await post('/drafts/restore');
      refresh();
    });
  };

  if (!list) return null;
  const { drafts, current, out_of_room: outOfRoom } = list;
  const inLine = drafts.filter((draft) => draft.place !== null);
  return (
    <section className="drafts" aria-label="Your drafts">
      <div className="row wrap drafts-head">
        <h2 className="section-title">Your drafts</h2>
        <button onClick={() => void startNew().catch((error: Error) => setProblem(error.message))}>New draft</button>
      </div>
      <p className="hint">
        Build a mix without touching what’s playing. Everything saves as you go.
      </p>
      {problem && <p className="warn" role="alert">{problem}</p>}
      {outOfRoom && (
        <p className="warn" role="status">
          Rendering has paused: your stems have reached their storage limit.{' '}
          <button className="link" onClick={() => setView('Workshop')}>Change the limit in Workshop</button>
        </p>
      )}
      {inLine.length > 0 && (
        <p className="hint" role="status">
          {current.left > 0
            ? `Your current mix goes first, with ${current.left} seam${current.left === 1 ? '' : 's'} left (${etaRangeWords(current.eta)}). Then these, in order, ahead of everything else.`
            : 'Your current mix is done, so these are rendering in order, ahead of everything else.'}
        </p>
      )}
      {drafts.length > 0 && (
        <ul className="draft-list">
          {drafts.map((draft) => (
            <li key={draft.id} className={draft.place ? 'draft in-line' : 'draft'}>
              <div className="draft-name">
                <button className="link draft-open" onClick={() => openDraft?.(draft.id)} aria-label={`Edit ${draft.name}`}>
                  <b>{draft.name}</b>
                </button>
                <span className="soft">
                  {draft.songs > 0 && `${draft.songs} ${draft.songs === 1 ? 'song' : 'songs'}, about ${length(draft.seconds)}. `}
                  {draftWords(draft)}
                </span>
                {draft.place === null && draft.waiting > 0 && draft.seams > 0 && (
                  <span className="soft"> Rendering it would take {etaRangeWords({ seconds: draft.to_render, low: draft.to_render, high: draft.to_render })}.</span>
                )}
                {draft.missing > 0 && (
                  <span className="soft"> {draft.missing} {draft.missing === 1 ? 'song has' : 'songs have'} left your library.</span>
                )}
              </div>
              <div className="row wrap draft-actions">
                <button disabled={draft.songs === 0} title={draft.songs === 0 ? 'Add a song first' : undefined} aria-label={`Play ${draft.name}`} onClick={() => void playDraft?.(draft.id)}>
                  Play
                </button>
                <button aria-label={`Edit ${draft.name}`} onClick={() => openDraft?.(draft.id)}>Edit</button>
                {draft.place !== null ? (
                  <span className="line-controls" role="group" aria-label={`${draft.name} in the render line`}>
                    <b className="line-place">{nth(draft.place)} in line</b>
                    <button aria-label={`Move ${draft.name} up the line`} disabled={draft.place === 1} onClick={() => void act(post<DraftList>(`/drafts/${draft.id}/line/move`, { step: -1 }))}>↑</button>
                    <button aria-label={`Move ${draft.name} down the line`} disabled={draft.place === inLine.length} onClick={() => void act(post<DraftList>(`/drafts/${draft.id}/line/move`, { step: 1 }))}>↓</button>
                    <button aria-label={`Take ${draft.name} out of the line`} onClick={() => void act(del<DraftList>(`/drafts/${draft.id}/line`))}>Take out</button>
                  </span>
                ) : (
                  draft.seams > 0 && draft.waiting > 0 && (
                    <button title="Renders in the background, right after your current mix" aria-label={`Prioritize ${draft.name}`} onClick={() => void prioritize(draft)}>
                      Prioritize
                    </button>
                  )
                )}
                <button aria-label={`Copy ${draft.name}`} onClick={() => void duplicate(draft)}>Copy</button>
                <button aria-label={`Delete ${draft.name}`} onClick={() => void remove(draft)}>✕</button>
              </div>
            </li>
          ))}
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
