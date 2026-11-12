import { memo } from 'react';
import { LibrarySong } from '../api';
import { clock, etaWords } from '../lib';
import { trackReadiness } from '../state/readiness';
import { Action, Menu, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SongMotif } from '../ui/MusicObjects';

/** What a Library row asks its page to do. The page passes one stable object, so a poll that leaves a
 * song's own facts alone does not re-render its row (MI-0162-04). */
export type LibraryRowActions = {
  toggle: (id: number, range: boolean) => void;
  open: (id: number) => void;
  start: (song: LibrarySong) => void | Promise<void>;
  analyse: (song: LibrarySong) => Promise<void>;
  add: (song: LibrarySong, playNext: boolean) => Promise<void>;
  priority: (song: LibrarySong) => Promise<void>;
  never: (song: LibrarySong) => Promise<void>;
};

export type LibraryRowProps = {
  song: LibrarySong;
  page: number;
  actions: LibraryRowActions;
  /** a checkbox is shown (batch on, and not the Set aside view) */
  selectable: boolean;
  selected: boolean;
  /** 200 are already chosen, so an unchosen box is disabled */
  selectionFull: boolean;
  searching: boolean;
  failed: boolean;
  building: boolean;
  /** this song's name is shared by another loaded recording, so its ID is shown */
  duplicate: boolean;
  /** this song's title is shared by a different artist's recording */
  sharedTitle: boolean;
  inMix: boolean;
  /** a search is active, so the server's match words are shown */
  searched: boolean;
  /** something is playing, so "Play next" makes sense */
  playing: boolean;
  /** where this song stands in the analysis line: -1 when it isn't in it */
  linePlace: number;
  eta: number | undefined;
  lyricsFlag: boolean;
  priorityFlag: boolean;
  neverFlag: boolean;
};

const lineWords = (place: number) => place < 0 ? 'Analyse now' : place === 0 ? 'Analysing…' : `Waiting, ${place} ahead`;

export const LibraryRow = memo(function LibraryRow({
  song, page, actions, selectable, selected, selectionFull, searching, failed, building, duplicate, sharedTitle,
  inMix, searched, playing, linePlace, eta, lyricsFlag, priorityFlag, neverFlag,
}: LibraryRowProps) {
  const facts = trackReadiness(song);
  const title = song.title ?? 'Untitled';
  const name = duplicate ? `${title} (song ${song.id})` : title;
  const spoken = duplicate || !sharedTitle ? name : `${title} by ${song.artist ?? 'Unknown artist'}`;
  const queued = linePlace >= 0;
  return (
    <li data-library-page={page} className={`song-row ${song.never ? 'never' : ''} ${selected ? 'selected' : ''}`}>
      <div className="song-name">
        {selectable && <label className="library-batch-check">
          <input type="checkbox" aria-label={`Select recording ${name} by ${song.artist ?? 'Unknown artist'}, ID ${song.id}`}
            checked={selected} disabled={searching || selectionFull && !selected}
            // a failed refresh holds the choice without disabling the box, so focus stays on it (MP-0297-03)
            aria-disabled={failed || undefined}
            onChange={(event) => { if (!failed) actions.toggle(song.id, (event.nativeEvent as MouseEvent).shiftKey === true); }} />
        </label>}
        <button className="link song-open" onClick={() => actions.open(song.id)} aria-label={`Details for ${spoken}`} data-focus-key={`song-details-${song.id}`}>
          <SongMotif songId={song.id} /><b dir="auto" title={title}>{title}</b>
        </button>
        <span dir="auto" title={song.artist ?? 'Unknown artist'}>{song.artist ?? 'Unknown artist'}</span>
        {duplicate && <small className="library-recording-id">Recording {song.id}</small>}
        {searched && song.match && <small className="hint" aria-label={`Search match: ${song.match}`}>{song.match}</small>}
      </div>
      <small className="facts song-columns">
        <span>{song.bpm !== null ? `${Math.round(song.bpm)} BPM` : 'Not analysed'}</span>
        {/* LX-0344-03: an unknown key says so, rather than leaving a bare dash */}
        <span>{song.camelot ?? (song.bpm !== null ? 'Key unknown' : 'No key yet')}</span>
        <span>{clock(song.duration)}</span>
        {lyricsFlag && song.lyric_status === 'synced' && <span>lyrics</span>}
      </small>
      <div className="song-readiness">
        <Status kind={facts.kind}>{facts.words}</Status>
        {facts.reason && !facts.canStartMix && <small className="hint song-why">{facts.reason}</small>}
      </div>
      <div className="song-actions">
        {facts.canStartMix && <Action title="Build a mix that starts here" working="Building your mix…" disabled={building || searching} run={() => actions.start(song)}>Start a mix</Action>}
        {facts.canAnalyse && (
          <Action disabled={queued} working="Asking…" run={() => actions.analyse(song)}>
            {song.readiness?.status === 'needs_attention' && !queued ? 'Try analysing again' : lineWords(linePlace)}
            {eta !== undefined && `, ${etaWords(eta)}`}
          </Action>
        )}
        {((!facts.setAside && (priorityFlag || neverFlag)) || facts.canAdd) && (
          <Menu title={`More actions for ${spoken}`} label={<><Icon name="more" /><span className="visually-hidden">More actions for {spoken}</span></>}>
            {facts.canAdd && <Action role="menuitem" disabled={inMix || searching} run={() => actions.add(song, false)} title="Puts it at the end of the current mix. Nothing starts playing.">{inMix ? 'Already in current mix' : 'Add to current mix'}</Action>}
            {facts.canAdd && playing && <Action role="menuitem" disabled={inMix || searching} run={() => actions.add(song, true)} title="Puts it straight after the song playing now. What's playing carries on.">Play next in current mix</Action>}
            {!facts.setAside && priorityFlag && <Action role="menuitemcheckbox" aria-checked={song.priority} run={() => actions.priority(song)} title="Prioritized songs are analysed first and their stem windows are protected from cache cleanup">
              {song.priority ? 'Priority: on' : 'Prioritize'}
            </Action>}
            {!facts.setAside && neverFlag && <Action role="menuitemcheckbox" aria-checked={song.never} run={() => actions.never(song)} title="Selecta won’t pick this when it builds a mix">
              {song.never ? 'Never: on' : 'Never play'}
            </Action>}
          </Menu>
        )}
      </div>
    </li>
  );
});
