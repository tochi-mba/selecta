import { memo, ReactNode, useContext, useState } from 'react';
import { HolderContext, openToPlay, type MusicHolder } from '../devices/controller';
import { relativeTime } from '../ui/format';
import { LibrarySong } from '../api';
import { clock, etaWords } from '../lib';
import { availabilityFacts } from '../state/availability';
import { trackReadiness } from '../state/readiness';
import { Action, Menu, Status, type StatusKind } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { SongMotif } from '../ui/MusicObjects';
import { CoverArt } from './CoverArt';
import { DrawnTick, PlayingBars, useReadyPop } from './feelPieces';
import { Matched } from './feelLibrary';
import { LibraryPlacesContext } from './LibraryPlaces';
import { PlaceChip } from './PlaceChip';

/** What a Library row asks its page to do. The page passes one stable object, so a poll that leaves a
 * song's own facts alone does not re-render its row (MI-0162-04). */
export type LibraryRowActions = {
  toggle: (id: number, range: boolean) => void;
  open: (id: number) => void;
  start: (song: LibrarySong) => void | Promise<void>;
  analyse: (song: LibrarySong) => Promise<void>;
  /** false: nothing was added (I85: an offer to move the music is showing instead) */
  add: (song: LibrarySong, playNext: boolean) => Promise<boolean | void>;
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
  /** I89: this row's song is the one playing now */
  current?: boolean;
  /** where this song stands in the analysis line: -1 when it isn't in it */
  linePlace: number;
  eta: number | undefined;
  lyricsFlag: boolean;
  priorityFlag: boolean;
  neverFlag: boolean;
  /** songs here are analysed (local mode); a browser library shows only the length */
  measured?: boolean;
  /** browser-first Cloud's row: one line, one status chip that says whether it plays here */
  browser?: boolean;
  /** library.art_embedded: the song's cover (its own picture, else its generated tile) in place of
   * the motif alone */
  art?: boolean;
  /** the feel (ADR-0477): the search's words to mark in the title and artist; empty marks nothing */
  mark?: string;
};

/** A status chip that pops once (.feel-pop) when it has just turned ready, its colour fading over
 * from the step before (feel-library.css) and its tick drawing itself in place of the plain check;
 * drawn plainly otherwise. The words are the same either way. */
function Chip({ kind, words, title }: { kind: StatusKind; words: ReactNode; title?: string }) {
  const pop = useReadyPop(kind);
  if (!pop) return <Status kind={kind} title={title}>{words}</Status>;
  return (
    <span key={pop} className="feel-pop feel-chip-pop">
      {/* Status's own markup with the drawn tick where its check would be */}
      <span className="status status-ready" title={title}><DrawnTick size="compact" />{words}</span>
    </span>
  );
}

/** The one chip a browser row shows: whether the song plays here, or the step that makes it. */
const HERE: Record<string, { kind: StatusKind; words: string }> = {
  here: { kind: 'ready', words: 'Ready' },
  hosted: { kind: 'ready', words: 'Ready' },
  reauth: { kind: 'needs-action', words: 'Allow again to play here' },
  reconnect: { kind: 'needs-action', words: 'Choose again to play here' },
  elsewhere: { kind: 'unavailable', words: 'Not in this browser' },
  nowhere: { kind: 'failed', words: 'Missing' },
};

/** ADR-0475 R6 row status, when the person has another device with music: "This device", "On
 * {device}" (open, has the file), "On {device}, open {when}" (had it, not open now, with "Open SelectaDJ on {device} to play this."), or
 * "No device right now". Null leaves the plain availability words. */
export function deviceChip(songId: number, availability: string, holder: MusicHolder | null, cloudWords = false): { kind: StatusKind; words: string; why: string; hint?: boolean } | null {
  if (!holder) return null;
  // library.places (T-20261125-67ba): a song in the cloud library is not on this device
  if (availability === 'hosted' && cloudWords) return { kind: 'ready', words: 'In your cloud library', why: 'Your cloud library plays it on any of your devices.' };
  if (availability === 'here' || availability === 'hosted') return { kind: 'ready', words: 'This device', why: 'This device has the file, so it can play here.' };
  if (availability !== 'elsewhere' && availability !== 'nowhere') return null;
  const places = holder.places?.(songId);
  const open = places ? places.online[0] : holder.online && (holder.ids ? holder.ids.has(songId) : true) ? holder.name : undefined;
  // I83: one plain line; a song an open device holds plays from here, on that device
  if (open) return { kind: 'ready', words: `Plays on ${open}`, why: `${open} has this song’s file and makes the sound.` };
  const away = places ? places.before[0] : holder.ids?.has(songId) ? holder.name : undefined;
  // I86: which device has it and when it was last open, with one hint and nothing to press
  if (away) {
    const age = holder.lastOpen?.(away);
    return { kind: 'paused', words: age == null ? `On ${away}` : `On ${away}, open ${relativeTime(age)}`, why: openToPlay(away), hint: true };
  }
  if (!places && availability === 'elsewhere') return null;
  return { kind: 'failed', words: 'No device right now', why: 'None of your devices has this song’s file right now.' };
}

const lineWords = (place: number) => place < 0 ? 'Analyse now' : place === 0 ? 'Analysing…' : `Waiting, ${place} ahead`;

export const LibraryRow = memo(function LibraryRow({
  song, page, actions, selectable, selected, selectionFull, searching, failed, building, duplicate, sharedTitle,
  inMix, searched, playing, current = false, linePlace, eta, lyricsFlag, priorityFlag, neverFlag, measured = true, browser = false, art = false, mark = '',
}: LibraryRowProps) {
  // the playing song's cover carries bars the beat bus moves on measured beats (feel-music.css
  // draws them only with data-feel~='music'); every other row's face is as it was
  const face = art
    ? <><CoverArt seed={song.id} songId={song.id} size="small" />{current && <span className="feel-row-bars" aria-hidden="true"><PlayingBars /></span>}</>
    : <SongMotif songId={song.id} />;
  const facts = trackReadiness(song);
  const where = availabilityFacts(song.availability);
  const holder = useContext(HolderContext);
  const placesChrome = useContext(LibraryPlacesContext);
  const [added, setAdded] = useState(false);
  const title = song.title ?? 'Untitled';
  const name = duplicate ? `${title} (song ${song.id})` : title;
  const spoken = duplicate || !sharedTitle ? name : `${title} by ${song.artist ?? 'Unknown artist'}`;
  const queued = linePlace >= 0;
  if (browser) {
    const artist = song.artist ?? 'Unknown artist';
    const remoteNext = !!holder?.speaking && playing && facts.canAdd && song.availability !== 'here' && song.availability !== 'hosted';
    // I85: the speaker lacks it and another open device has it: the tap offers to move there
    const movesTo = remoteNext && holder?.ids && !holder.ids.has(song.id) ? holder.places?.(song.id).online.find((name) => name !== holder.name) ?? null : null;
    const chip = facts.setAside || song.never
      ? { kind: 'paused' as StatusKind, words: facts.setAside ? 'Set aside' : 'Never played', why: facts.setAside ? facts.reason : 'SelectaDJ will not pick this song for mixes.' }
      : song.availability && HERE[song.availability]
        // ADR-0475 R6: the person has other devices, so say which one has the song, not "not here"
        ? deviceChip(song.id, song.availability, holder, !!placesChrome) ?? { ...HERE[song.availability], why: song.availability === 'elsewhere' ? 'Choose your music folder in this browser to play it here.' : where?.reason ?? '' }
        : { kind: facts.kind, words: facts.words, why: facts.reason };
    // library.places: where it is kept, and apart from that whether it can play here
    const placed = placesChrome && song.places;
    return (
      <li data-library-page={page} className={`song-row lw-row ${song.never ? 'never' : ''} ${selected ? 'selected' : ''}`} data-lift="row">
        {selectable && <label className="library-batch-check lw-check">
          <input type="checkbox" aria-label={`Select ${name} by ${artist}`}
            checked={selected} disabled={searching || selectionFull && !selected}
            aria-disabled={failed || undefined}
            onChange={(event) => { if (!failed) actions.toggle(song.id, (event.nativeEvent as MouseEvent).shiftKey === true); }} />
        </label>}
        <button className="link song-open lw-open" onClick={() => actions.open(song.id)} aria-label={`Details for ${name} ${artist}${searched && song.match ? ` · ${song.match}` : ''}`} data-focus-key={`song-details-${song.id}`}>
          {face}
          <span className="lw-song">
            {/* the name holds every word the row shows (WCAG 2.5.3), so title and artist are two words apart */}
            <b dir="auto" title={title}><Matched text={title} mark={mark} /></b>{' '}
            <span dir="auto" title={artist}><Matched text={artist} mark={mark} />{searched && song.match ? ` · ${song.match}` : ''}</span>
          </span>
        </button>
        <span className="lw-length">{clock(song.duration)}</span>
        <span className={placed ? 'lw-state lw-places' : 'lw-state'}>
          {placed ? <PlaceChip song={song} offline={placesChrome.offline} holder={holder} onOpen={() => actions.open(song.id)} aside={facts.setAside ? 'Set aside' : song.never ? 'Never played' : undefined} /> : <>
            <Chip kind={chip.kind} title={chip.why || undefined} words={chip.words} />
            {chip.why && chip.kind !== 'ready' && <small className="lw-why" data-hint={'hint' in chip && chip.hint ? '' : undefined}>{chip.why}</small>}
          </>}
          {/* I84: what the row's tap did, said in the row itself for a moment */}
          {remoteNext && <span className={added || (current && holder?.speaking) ? 'lw-added' : 'lw-added lw-in-mix'} role="status">{added ? `Added to ${holder?.name}’s mix` : current && holder?.speaking ? `Playing now on ${holder.name}` : inMix ? 'In the mix' : ''}</span>}
        </span>
        <div className="song-actions lw-actions">
          {/* I84: on a remote while another device plays, the row's one tap puts the song next
              there, says so for a screen reader, and confirms in the row */}
          {remoteNext
            ? movesTo
              ? <Action className="lw-start small" title={`Play on ${movesTo}`} aria-label={`Play ${spoken} on ${movesTo}`} disabled={searching} run={() => actions.add(song, true)}><Icon name="play" size="compact" /><span>Play on {movesTo}</span></Action>
              : !inMix && <Action className="lw-start small" title={`Play next on ${holder?.name}`} aria-label={`Play ${spoken} next on ${holder?.name}`} disabled={searching} run={async () => { if (await actions.add(song, true) === false) return; setAdded(true); window.setTimeout(() => setAdded(false), 3000); }}><Icon name="next" size="compact" /><span>Play next</span></Action>
            : facts.canStartMix && <Action className="lw-start small" title="Build a mix that starts here" aria-label={`Start a mix from ${spoken}`} limit={0} disabled={building || searching} run={() => actions.start(song)}><Icon name="play" size="compact" /><span>Start a mix</span></Action>}
          {((!facts.setAside && neverFlag) || facts.canAdd) && (
            <Menu title={`More actions for ${spoken}`} label={<><Icon name="more" /><span className="visually-hidden">More actions for {spoken}</span></>}>
              <Action role="menuitem" run={() => actions.open(song.id)}>Song details</Action>
              {facts.canAdd && <Action role="menuitem" disabled={inMix || searching} run={() => actions.add(song, false)}>{inMix ? 'Already in current mix' : 'Add to current mix'}</Action>}
              {facts.canAdd && playing && <Action role="menuitem" disabled={inMix || searching} run={() => actions.add(song, true)}>Play next</Action>}
              {!facts.setAside && neverFlag && <Action role="menuitemcheckbox" aria-checked={song.never} run={() => actions.never(song)} title="SelectaDJ won’t pick this when it builds a mix">
                {song.never ? 'Never: on' : 'Never play'}
              </Action>}
            </Menu>
          )}
        </div>
      </li>
    );
  }
  return (
    <li data-library-page={page} className={`song-row ${song.never ? 'never' : ''} ${selected ? 'selected' : ''}`} data-lift="row">
      <div className="song-name">
        {selectable && <label className="library-batch-check">
          <input type="checkbox" aria-label={`Select recording ${name} by ${song.artist ?? 'Unknown artist'}, ID ${song.id}`}
            checked={selected} disabled={searching || selectionFull && !selected}
            // a failed refresh holds the choice without disabling the box, so focus stays on it (MP-0297-03)
            aria-disabled={failed || undefined}
            onChange={(event) => { if (!failed) actions.toggle(song.id, (event.nativeEvent as MouseEvent).shiftKey === true); }} />
        </label>}
        <button className="link song-open" onClick={() => actions.open(song.id)} aria-label={`Details for ${spoken}`} data-focus-key={`song-details-${song.id}`}>
          {face}<b dir="auto" title={title}><Matched text={title} mark={mark} /></b>
        </button>
        <span dir="auto" title={song.artist ?? 'Unknown artist'}><Matched text={song.artist ?? 'Unknown artist'} mark={mark} /></span>
        {duplicate && <small className="library-recording-id">Recording {song.id}</small>}
        {searched && song.match && <small className="hint" aria-label={`Search match: ${song.match}`}>{song.match}</small>}
      </div>
      <small className="facts song-columns">
        {/* S4-0091-05: the spaces between facts are dropped by the flex layout but keep NVDA from
            running them together ("120 BPM8A1:30Ready") when it reads the row as one line */}
        {/* a browser library shows tempo and key only for songs the account has measured */}
        {measured && <><span>{song.bpm !== null ? `${Math.round(song.bpm)} BPM` : 'Not analysed'}</span>{' '}</>}
        {/* LX-0344-03: an unknown key says so, rather than leaving a bare dash */}
        {measured && <><span>{song.camelot ?? (song.bpm !== null ? 'Key unknown' : 'No key yet')}</span>{' '}</>}
        <span>{clock(song.duration)}</span>{' '}
        {lyricsFlag && song.lyric_status === 'synced' && <><span>lyrics</span>{' '}</>}
      </small>{' '}
      <div className="song-readiness">
        {where && <Status kind={where.kind}>{where.words}</Status>}
        {where && !where.canPlay && <small className="hint song-why">{where.reason}</small>}
        {/* a song that can't play here is explained by where it is; its readiness would only repeat it */}
        {!(where && !where.canPlay) && <Chip kind={facts.kind} words={facts.words} />}
        {!(where && !where.canPlay) && facts.reason && !facts.canStartMix && <small className="hint song-why">{facts.reason}</small>}
      </div>
      <div className="song-actions">
        {facts.canStartMix && <Action title="Build a mix that starts here" working="Building your mix…" limit={0} disabled={building || searching} run={() => actions.start(song)}>Start a mix</Action>}
        {facts.canAnalyse && measured && !browser && (
          <Action disabled={queued} working="Asking…" run={() => actions.analyse(song)}>
            {song.readiness?.status === 'needs_attention' && !queued ? 'Try analysing again' : lineWords(linePlace)}
            {eta !== undefined && `, ${etaWords(eta)}`}
          </Action>
        )}
        {((!facts.setAside && (priorityFlag || neverFlag)) || facts.canAdd) && (
          <Menu title={`More actions for ${spoken}`} label={<><Icon name="more" /><span className="visually-hidden">More actions for {spoken}</span></>}>
            {facts.canAdd && <Action role="menuitem" disabled={inMix || searching} run={() => actions.add(song, false)} title="Puts it at the end of the current mix. Nothing starts playing.">{inMix ? 'Already in current mix' : 'Add to current mix'}</Action>}
            {facts.canAdd && playing && <Action role="menuitem" disabled={inMix || searching} run={() => actions.add(song, true)} title="Puts it straight after the song playing now. What's playing carries on.">Play next in current mix</Action>}
            {!facts.setAside && priorityFlag && <Action role="menuitemcheckbox" aria-checked={song.priority} run={() => actions.priority(song)} title={browser ? 'This device measures it before the other songs waiting' : 'Prioritized songs are analysed first and their stem windows are protected from cache cleanup'}>
              {browser ? (song.priority ? 'Measure first: on' : 'Measure this first') : song.priority ? 'Priority: on' : 'Prioritize'}
            </Action>}
            {!facts.setAside && neverFlag && <Action role="menuitemcheckbox" aria-checked={song.never} run={() => actions.never(song)} title="SelectaDJ won’t pick this when it builds a mix">
              {song.never ? 'Never: on' : 'Never play'}
            </Action>}
          </Menu>
        )}
      </div>
    </li>
  );
});
