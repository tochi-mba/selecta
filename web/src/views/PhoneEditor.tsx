import { ReactNode, RefObject, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, type MixItem } from '../api';
import { flagOn } from '../flags';
import { length } from '../lib';
import { MixReadiness } from '../state/readiness';
import { Action } from '../ui/controls';
import { Icon } from '../ui/Icon';
import type { PlayerLike } from '../playerContract';
import type { RowActions } from './EditorRows';
import type { EditorLayout } from './editorLayout';
import { TransitionsWorkedOutLive } from './editorMode';
import { MixMap } from './MixMap';
import { HEAR_LEAD, LiveTransitionPanel, SongPanel } from './PhonePanels';
import { PhoneSheet } from './PhoneSheet';
import { PhoneStory } from './PhoneStory';
import './phoneEditor.css';

export type PhoneEditorProps = {
  layout: Exclude<EditorLayout, 'classic'>;
  mix: MixItem[];
  keys: string[];
  mixName: string;
  draftId: number | null;
  names: Record<string, string>;
  guard: Record<string, string>;
  readiness: MixReadiness;
  totalSeconds: number;
  playingIndex: number;
  player: PlayerLike;
  playDraft?: (draftId: number, position?: number) => unknown;
  selectedSeam: number;
  selectedSong: number;
  openSeam: (index: number) => void;
  openSong: (index: number) => void;
  close: () => void;
  /** the full transition inspector, where the server renders transitions (seam_inspector) */
  seamInspector: ReactNode;
  actions: RefObject<RowActions>;
  movingKey: string | null;
  affected: Set<number> | null;
  primary: ReactNode;
  more: ReactNode;
  switcher: ReactNode;
  undo: ReactNode;
  problem: string;
  clearProblem: () => void;
  refreshMix: () => void;
  adding: string | null;
  setAdding: (anchor: string | null) => void;
  adder: (anchor: string) => ReactNode;
  waveformOf?: (songId: number) => Promise<number[] | null>;
  /** forms and notices that belong under the header: rename, Save a copy, Download, what went */
  below?: ReactNode;
};

/** The editor laid out for any screen (editor.phone_layout): a header that says what's being edited
 * and whether it's saved, the mix as a strip, and the mix as a story of songs and the transitions
 * between them. On a phone an opened song or transition rises from the bottom; with room for two
 * panes it opens beside the list. Every write still goes through the editor's own actions. */
/** Two panes need this much room in the page itself (Material's compact width); a tablet held upright
 * beside the app's rail has less, so its opened song or transition rises in a sheet instead. */
const PANES_FROM = 600;

export function PhoneEditor(props: PhoneEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(true);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(([entry]) => setRoomy(entry.contentRect.width >= PANES_FROM));
    watch.observe(node);
    return () => watch.disconnect();
  }, []);
  const layout = props.layout === 'panes' && !roomy ? 'sheet' : props.layout;
  const { mix, keys, mixName, draftId, names, guard, readiness, totalSeconds, playingIndex, player, playDraft,
    selectedSeam, selectedSong, openSeam, openSong, seamInspector, actions, movingKey, affected,
    primary, more, switcher, undo, problem, clearProblem, refreshMix, adding, setAdding, adder, waveformOf, below } = props;
  const closePane = () => {
    // a side pane isn't a dialog, so focus goes back by hand to what opened it
    const back = selectedSeam > 0 ? `[data-pe-seam="${CSS.escape(`${keys[selectedSeam - 1]}>${keys[selectedSeam]}`)}"] .pe-seam-open`
      : selectedSong >= 0 ? `[data-song-key="${CSS.escape(keys[selectedSong])}"] .pe-song-open` : null;
    props.close();
    if (back) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(back)?.focus());
  };
  const close = layout === 'panes' ? closePane : props.close;
  const inDraft = draftId !== null;
  const live = useContext(TransitionsWorkedOutLive);
  const heading = useId();
  const list = useRef<HTMLOListElement>(null);
  const [sending, setSending] = useState(0);
  // refused: the server answered no (nothing changed, so the mix is still saved); failed: no answer
  const [failed, setFailed] = useState<{ words: string; retry: (() => Promise<void>) | null } | null>(null);
  const [showMore, setShowMore] = useState(false);

  /** Every change made here: counted while it travels, so the header can say Saving, and kept if it
   * fails, so Try again sends exactly it again. */
  const send = async (work: () => Promise<void>) => {
    setSending((count) => count + 1);
    setFailed(null);
    clearProblem();
    try {
      await work();
    } catch (error) {
      const refused = error instanceof ApiError && error.status > 0 && error.status < 500;
      setFailed({ words: (error as Error).message, retry: refused ? null : () => send(work) });
    } finally {
      setSending((count) => count - 1);
    }
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= mix.length) return;
    void send(() => actions.current.move(from, to, to < from ? 'up' : 'down'));
  };

  const playFrom = (index: number, offset?: number) => {
    if (inDraft) void playDraft?.(draftId, mix[index]?.position ?? index);
    else void player.playFrom(mix[index]?.position ?? index, offset);
  };
  const notSaved = !!failed?.retry;
  const saveWords = sending > 0 || movingKey ? 'Saving…' : notSaved ? 'Not saved' : inDraft ? 'Saved' : 'Saved, and playing as it is';
  const ready = !readiness.seams ? null : live ? null : readiness.allReady ? 'All transitions ready' : `${readiness.ready} of ${readiness.seams} transitions ready`;

  const seamItem = selectedSeam > 0 ? mix[selectedSeam] : null;
  const seamBefore = selectedSeam > 0 ? mix[selectedSeam - 1] : null;
  const song = selectedSong >= 0 ? mix[selectedSong] : null;
  const panelTitle = seamItem ? `Into ${seamItem.title}` : song ? song.title : '';
  const panel = seamItem && seamBefore ? (
    flagOn('seam_inspector') && seamInspector ? seamInspector : (
      <LiveTransitionPanel
        key={`${keys[selectedSeam - 1]}>${keys[selectedSeam]}`}
        previous={seamBefore}
        item={seamItem}
        names={names}
        guard={guard}
        refresh={refreshMix}
        waveformOf={waveformOf}
        hearWords={inDraft ? `Plays this draft from ${seamBefore.title}. What was playing stops.` : `Plays the mix from ${HEAR_LEAD} seconds before this transition.`}
        onHear={() => playFrom(selectedSeam - 1, inDraft ? undefined : Math.max(0, (seamBefore.duration || 0) - HEAR_LEAD))}
        onAddBetween={() => { close(); setAdding(keys[selectedSeam - 1]); }}
      />
    )
  ) : song ? (
    <SongPanel
      key={keys[selectedSong]}
      item={song}
      index={selectedSong}
      total={mix.length}
      playWords={inDraft ? 'Play the draft from here' : 'Play from here'}
      onPlay={() => playFrom(selectedSong)}
      onMove={(to) => { const from = selectedSong; if (layout === 'sheet') close(); move(from, to); }}
      onAddAfter={() => { const anchor = keys[selectedSong]; close(); setAdding(anchor); }}
      onLock={flagOn('editor.locks') ? () => send(() => actions.current.lock(song)) : undefined}
      onRemove={async () => {
        const key = keys[selectedSong];
        close();
        await send(() => actions.current.remove(song, key));
      }}
    />
  ) : null;

  return (
    <div ref={root} className={`pe-editor is-${layout}`} data-editor-layout={layout}>
      <header className="pe-head">
        {switcher}
        <p className={`pe-scope ${inDraft ? 'is-draft' : 'is-current'}`}>
          <b>{inDraft ? 'Draft' : 'Current mix'}</b>
          <span>{inDraft ? 'What’s playing isn’t touched.' : 'Changes play straight away.'}</span>
        </p>
        <h1 className="pe-title" dir="auto">{mixName}</h1>
        <p className="pe-facts">
          <span>{mix.length} {mix.length === 1 ? 'song' : 'songs'}</span>
          <span>{length(totalSeconds)}</span>
          {ready && <span>{ready}</span>}
          <span className={`pe-save ${notSaved ? 'is-failed' : sending || movingKey ? 'is-saving' : ''}`} role="status">{saveWords}</span>
        </p>
        {(failed || problem) && (
          <div className="pe-not-saved" role="alert">
            <p>{failed?.words ?? problem}</p>
            {failed?.retry ? <Action run={failed.retry}>Try again</Action> : <button type="button" onClick={() => { setFailed(null); clearProblem(); refreshMix(); }}>OK</button>}
          </div>
        )}
        <div className="pe-actions">
          {primary}
          {undo}
          <button type="button" className="pe-more" aria-haspopup="dialog" onClick={() => setShowMore(true)}><Icon name="more" /> Mix actions</button>
        </div>
      </header>
      {below}

      {mix.length > 1 && (
        <MixMap
          mix={mix}
          playingIndex={playingIndex}
          player={inDraft ? null : player}
          onPlayFrom={(index) => playFrom(index)}
          playWords={inDraft ? 'Choose a song to play the draft from there.' : 'Choose a song to play from there.'}
        />
      )}

      <div className="pe-body">
        <section className="pe-story-wrap" aria-labelledby={heading}>
          <h2 id={heading} className="pe-story-heading" tabIndex={-1} data-mode-heading="arrange">Songs and transitions</h2>
          <PhoneStory
            mix={mix}
            keys={keys}
            names={names}
            selectedSeam={selectedSeam}
            selectedSong={selectedSong}
            playingIndex={playingIndex}
            movingKey={movingKey}
            affected={affected}
            onOpenSeam={(index) => (selectedSeam === index && layout === 'panes' ? close() : openSeam(index))}
            onOpenSong={(index) => (selectedSong === index && layout === 'panes' ? close() : openSong(index))}
            onMove={move}
            onCarry={(from, over) => { actions.current.dragFrom(from); actions.current.dragOver(over); }}
            headingId={heading}
            list={list}
            requests={!inDraft}
          />
          <button type="button" className="pe-add" onClick={() => setAdding(keys[keys.length - 1])}><Icon name="plus" /> Add songs</button>
        </section>
        {layout === 'panes' && (
          <aside className="pe-pane" aria-label={panel ? panelTitle : 'Nothing open'}>
            {panel ? (
              <>
                <div className="pe-pane-head">
                  <h2 dir="auto">{panelTitle}</h2>
                  <button type="button" className="pe-icon-button" aria-label={`Close ${panelTitle}`} title="Close" onClick={close}><Icon name="close" /></button>
                </div>
                {panel}
              </>
            ) : (
              <div className="pe-pane-empty">
                <h2>Choose a transition or a song</h2>
                <p className="hint">A transition opens here so you can hear it and change how it moves. A song opens with everything you can do to it.</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {layout === 'sheet' && panel && (
        <PhoneSheet key={seamItem ? `seam-${selectedSeam}` : `song-${selectedSong}`} title={panelTitle} onClose={close} size={seamItem ? 'resizable' : 'fit'}>
          {panel}
        </PhoneSheet>
      )}
      {showMore && (
        <PhoneSheet title="Mix actions" onClose={() => setShowMore(false)} size="fit">
          <div className="pe-list-actions" onClick={(event) => { if ((event.target as HTMLElement).closest('button, a')) setShowMore(false); }}>
            {more}
          </div>
        </PhoneSheet>
      )}
      {adding !== null && (
        <PhoneSheet title="Add a song" onClose={() => setAdding(null)} size="tall">
          {adder(adding)}
        </PhoneSheet>
      )}
    </div>
  );
}
