import { useEffect, useRef, useState } from 'react';
import { feelOn } from '../feel/root';
import { motionMs } from '../ui/exitMotion';
import { clock } from '../lib';
import type { EditOp, Ledger, LedgerSeam, ProposalSnapshot, PSeam, PSong, Selection } from '../lucy/types';
import { bpmWords, energyWords, isReadyStatus, keyDistanceWords, keyWords, seamWords, tempoGapWords } from '../lucy/words';
import { Action, Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { energySummary, measuredEnergy, SongMotif } from '../ui/MusicObjects';
import { lucyTransport } from '../lucy/client';

/** The proposed songs in their exact order, each one known by its place in the mix rather than its
 * song, so the same song twice is still two rows. Between each pair is that transition's real state
 * from the readiness ledger. Every change has a button: nothing here needs dragging. */

/** Measured energy only. A song with no measurement is a dashed outline, never a guess. */
export function EnergyBars({ values }: { values: (number | null)[] }) {
  if (!values.length) return null;
  const energies = values.map(measuredEnergy);
  const known = energies.filter((value): value is number => value !== null);
  const scale = known.length && Math.max(...known) > 1 ? Math.max(...known) : 1;
  const unknown = energies.length - known.length;
  const summary = energySummary(energies);
  return (
    <figure className="lucy-energy">
      <div className="lucy-energy-bars" role="img" aria-label={summary}>
        {energies.map((energy, index) => (energy === null
          ? <span key={index} className="bar unknown" title={`Song ${index + 1}: energy unknown`} />
          : <span key={index} className="bar" style={{ height: `${10 + Math.max(0, Math.min(1, energy / scale)) * 90}%` }} title={`Song ${index + 1}: ${energyWords(energy).toLowerCase()}`} />))}
      </div>
      <figcaption className="hint">
        {summary}.
        {unknown > 0 && <> <span className="lucy-energy-key" aria-hidden="true" /> Dashed outline: energy unknown.</>}
      </figcaption>
    </figure>
  );
}

const HISTORY_WORDS: Record<PSeam['evidence']['history'], string> = {
  liked: 'You liked this transition before',
  clean: 'Played cleanly before',
  failed: 'Didn’t work before',
  unknown: '',
};
const PROVENANCE_WORDS: Record<PSeam['evidence']['provenance'], string> = {
  playable: '',
  history_only: 'Known from your listening only',
  predicted: 'Not tried yet',
  user_rated: 'You rated this one',
};

function SeamRow({ seam, entry, readyOnly, number, into, onAsk, selected }: {
  seam: PSeam | undefined;
  entry: LedgerSeam | undefined;
  readyOnly: boolean;
  number: number;
  into: PSong;
  onAsk: () => void;
  selected: boolean;
}) {
  const status = entry?.status ?? seam?.ready.status ?? 'none';
  const verified = entry?.verified ?? seam?.ready.verified ?? false;
  const words = seamWords(status, verified);
  const requested = seam?.requested_label || seam?.requested || entry?.requested || '';
  const rendered = seam?.ready.rendered_label || seam?.ready.rendered || entry?.rendered || '';
  const evidence = seam?.evidence;
  const notes = [HISTORY_WORDS[evidence?.history ?? 'unknown'], PROVENANCE_WORDS[evidence?.provenance ?? 'playable']].filter(Boolean);
  return (
    <div className={`lucy-seam ${selected ? 'is-selected' : ''}`} role="group" aria-label={`Transition ${number}`}>
      <div className="lucy-seam-main">
        <p className="lucy-seam-head">
          {requested ? <>Planned: <span dir="auto">{requested}</span></> : 'No transition chosen yet'}
          {rendered && rendered !== requested && <> · Made as: <span dir="auto">{rendered}</span></>}
        </p>
        <Status kind={words.kind}>{words.words}</Status>
        {readyOnly && verified && isReadyStatus(status) && (
          <p className="lucy-proof"><Icon name="check" size="compact" /> Checked on disk{entry?.proof ? ` · ${entry.proof}` : ''}</p>
        )}
        {evidence && <p className="hint">{tempoGapWords(evidence.tempo_gap)} · {keyDistanceWords(evidence.key_distance)}{notes.length ? ` · ${notes.join(' · ')}` : ''}</p>}
        {!!seam?.warnings.length && <ul className="lucy-warnings">{seam.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </div>
      <button type="button" className="quiet" aria-pressed={selected} onClick={onAsk} aria-label={`Ask about this: the transition into ${into.title || 'this song'}`}>Ask about this</button>
    </div>
  );
}

/** A song the newest revision took out, and where it stood before. */
type Gone = { song: PSong; at: number };

export function SongsAndSeams({ snapshot, ledger, editable, selection, onEdit, onAsk }: {
  snapshot: ProposalSnapshot;
  ledger: Ledger | undefined;
  editable: boolean;
  selection: Selection | null;
  onEdit: (op: EditOp) => Promise<boolean>;
  onAsk: (selection: Selection, label: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const songs = snapshot.songs;
  // Songs a new current revision really added glow once with a lit edge (lucy.css). The first list
  // shown, and an older revision being looked at, have nothing new in them. Worked out once per
  // revision, so a redraw never lights a row again.
  // Songs it really took out stay a moment, struck through, and fold away (only with the feel's
  // motion on; otherwise they simply go, as before). They are hidden from assistive technology,
  // because the summary above already says what was taken out.
  const seen = useRef<{ snapshot: ProposalSnapshot | null; known: Set<string> | null; added: Set<string>; before: PSong[]; gone: Gone[] }>({ snapshot: null, known: null, added: new Set(), before: [], gone: [] });
  if (seen.current.snapshot !== snapshot) {
    const before = seen.current.known;
    const now = songs.map((song) => song.occurrence);
    const kept = new Set(now);
    const gone = before && editable && feelOn('motion')
      ? seen.current.before.flatMap((song, at) => (kept.has(song.occurrence) ? [] : [{ song, at }]))
      : [];
    seen.current = { snapshot, known: kept, added: new Set(before && editable ? now.filter((occurrence) => !before.has(occurrence)) : []), before: songs, gone };
  }
  const added = seen.current.added;
  const [, redraw] = useState(0);
  const forget = (occurrence?: string) => {
    seen.current.gone = occurrence ? seen.current.gone.filter((item) => item.song.occurrence !== occurrence) : [];
    redraw((count) => count + 1);
  };
  const leaving = seen.current.gone.length;
  useEffect(() => {
    if (!leaving) return undefined;
    // the fallback for when no animationend arrives (a hidden tab, or the motion turned off meanwhile)
    const timer = window.setTimeout(() => forget(), motionMs('--motion-handoff', 200) * 2 + 400);
    return () => window.clearTimeout(timer);
    // only a new revision starts a new leaving; forget is rebuilt on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, leaving > 0]);
  const goneBefore = (index: number) => seen.current.gone.filter((item) => Math.min(item.at, songs.length) === index);
  const ghost = ({ song }: Gone) => (
    <li key={`gone-${song.occurrence}`} className="lucy-song-slot is-gone feel-collapse-out" aria-hidden="true" inert
      onAnimationEnd={(event) => { if (event.target === event.currentTarget) forget(song.occurrence); }}>
      <div className="lucy-song">
        <span className="lucy-song-n" />
        <div className="lucy-song-main">
          <p className="lucy-song-name"><b dir="auto">{song.title || 'Untitled'}</b> <span className="soft" dir="auto">{song.artist || 'Unknown artist'}</span></p>
        </div>
      </div>
    </li>
  );
  const seamOf = (a: string, b: string) => snapshot.seams.find((seam) => seam.a_occ === a && seam.b_occ === b);
  const entryOf = (a: string, b: string) => ledger?.seams.find((seam) => seam.a_occ === a && seam.b_occ === b);

  const change = async (op: EditOp, focus: { occurrence: string; act: string } | null) => {
    if (busy || !editable) return;
    setBusy(true);
    try {
      const done = await onEdit(op);
      if (!done) return;
      // the row has moved or gone, so focus goes back to the same control on the same song, or the next one
      window.requestAnimationFrame(() => {
        if (!focus) return;
        const occurrence = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(focus.occurrence) : focus.occurrence.replace(/["\\]/g, '');
        const row = list.current?.querySelector<HTMLElement>(`[data-occ="${occurrence}"]`);
        const control = row?.querySelector<HTMLButtonElement>(`[data-act="${focus.act}"]`);
        (control && !control.disabled ? control : row?.querySelector<HTMLElement>('[data-act="ask"]'))?.focus({ preventScroll: true });
      });
    } finally {
      setBusy(false);
    }
  };
  const blockedWords = editable ? undefined : 'Make this the current revision to change it';
  // ADR-0476: a browser mix measures nothing ahead and plays every transition live, so its rows
  // show the length only, with no locks and no transition rows to read
  const live = lucyTransport() !== null;

  return (
    <ol className={`lucy-songs ${live ? 'is-compact' : ''}`} ref={list} aria-label="Songs in order, with the transitions between them">
      {/* one flat list of keyed rows, so a moved song keeps its row (and the focus inside it) */}
      {songs.flatMap((song, index) => {
        const previous = songs[index - 1];
        const nextSong = songs[index + 1];
        const songSelected = selection?.occurrence === song.occurrence;
        const name = song.title || 'Untitled';
        return [
          ...goneBefore(index).map(ghost),
          <li key={song.occurrence} className="lucy-song-slot">
            {previous && !live && (
              <SeamRow
                seam={seamOf(previous.occurrence, song.occurrence)}
                entry={entryOf(previous.occurrence, song.occurrence)}
                readyOnly={snapshot.ready_only}
                number={index}
                into={song}
                selected={!!selection?.seam && selection.seam[0] === previous.occurrence && selection.seam[1] === song.occurrence}
                onAsk={() => onAsk({ seam: [previous.occurrence, song.occurrence] }, `the transition from ${previous.title || 'song ' + index} into ${name}`)}
              />
            )}
            <div className={`lucy-song ${songSelected ? 'is-selected' : ''} ${song.locked ? 'is-locked' : ''}${added.has(song.occurrence) ? ' feel-flash' : ''}`} data-occ={song.occurrence}>
              <span className="lucy-song-n" aria-hidden="true">{index + 1}</span>
              <div className="lucy-song-main">
                {!live && <SongMotif songId={song.song_id} />}
                <p className="lucy-song-name"><span className="visually-hidden">Song {index + 1}: </span><b dir="auto">{name}</b> <span className="soft" dir="auto">{song.artist || 'Unknown artist'}</span></p>
                <p className="lucy-song-facts">
                  {song.duration > 0 ? clock(song.duration) : 'Length unknown'}{!live && <> · {bpmWords(song.bpm)} · {keyWords(song.key)} · {energyWords(song.energy)}</>}
                  {song.locked && <> · <span className="icon-words"><Icon name="lock" size="compact" /> Locked</span></>}
                </p>
              </div>
              <div className="lucy-song-actions" role="group" aria-label={`Change ${name}`}>
                {/* W5: each change is an Action, so the pressed control says it's working while Lucy's
                    revision is saved, and the others wait their turn */}
                {!live && (
                  <Action type="button" data-act="lock" aria-pressed={song.locked} waiting={busy || !editable} title={blockedWords}
                    run={() => change({ op: song.locked ? 'unlock' : 'lock', occurrence: song.occurrence }, { occurrence: song.occurrence, act: 'lock' })}>
                    {song.locked ? 'Unlock' : 'Lock'}
                  </Action>
                )}
                <Action type="button" data-act="up" disabled={index === 0} waiting={busy || !editable} aria-label={`Move ${name} up`} title={blockedWords ?? `Move ${name} up`}
                  run={() => change({ op: 'move', occurrence: song.occurrence, to: index - 1 }, { occurrence: song.occurrence, act: 'up' })}>
                  <Icon name="up" />
                </Action>
                <Action type="button" data-act="down" disabled={!nextSong} waiting={busy || !editable} aria-label={`Move ${name} down`} title={blockedWords ?? `Move ${name} down`}
                  run={() => change({ op: 'move', occurrence: song.occurrence, to: index + 1 }, { occurrence: song.occurrence, act: 'down' })}>
                  <Icon name="down" />
                </Action>
                <Action type="button" data-act="remove" waiting={busy || !editable} aria-label={`Remove ${name}`} title={blockedWords ?? `Remove ${name}`}
                  run={() => change({ op: 'remove', occurrence: song.occurrence }, (nextSong ?? previous) ? { occurrence: (nextSong ?? previous).occurrence, act: 'remove' } : null)}>
                  <Icon name="trash" />
                </Action>
                <button type="button" data-act="ask" className="quiet" aria-pressed={songSelected} aria-label={`Ask about this: ${name}`}
                  onClick={() => onAsk({ occurrence: song.occurrence }, name)}>
                  Ask about this
                </button>
              </div>
            </div>
          </li>,
        ];
      })}
      {goneBefore(songs.length).map(ghost)}
    </ol>
  );
}
