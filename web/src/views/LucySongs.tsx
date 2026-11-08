import { useRef, useState } from 'react';
import { clock } from '../lib';
import type { EditOp, Ledger, LedgerSeam, ProposalSnapshot, PSeam, PSong, Selection } from '../lucy/types';
import { bpmWords, energyWords, isReadyStatus, keyDistanceWords, keyWords, seamWords, tempoGapWords } from '../lucy/words';
import { Status } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { energySummary, measuredEnergy } from '../ui/MusicObjects';

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
          <p className="lucy-proof"><Icon name="check" width={14} height={14} /> Checked on disk{entry?.proof ? ` · ${entry.proof}` : ''}</p>
        )}
        {evidence && <p className="hint">{tempoGapWords(evidence.tempo_gap)} · {keyDistanceWords(evidence.key_distance)}{notes.length ? ` · ${notes.join(' · ')}` : ''}</p>}
        {!!seam?.warnings.length && <ul className="lucy-warnings">{seam.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </div>
      <button type="button" className="quiet" aria-pressed={selected} onClick={onAsk} aria-label={`Ask about the transition into ${into.title || 'this song'}`}>Ask about this</button>
    </div>
  );
}

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
        const row = list.current?.querySelector<HTMLElement>(`[data-occ="${CSS.escape(focus.occurrence)}"]`);
        const control = row?.querySelector<HTMLButtonElement>(`[data-act="${focus.act}"]`);
        (control && !control.disabled ? control : row?.querySelector<HTMLElement>('[data-act="ask"]'))?.focus({ preventScroll: true });
      });
    } finally {
      setBusy(false);
    }
  };
  const blockedWords = editable ? undefined : 'Make this the current revision to change it';

  return (
    <ol className="lucy-songs" ref={list} aria-label="Songs in order, with the transitions between them">
      {songs.map((song, index) => {
        const previous = songs[index - 1];
        const nextSong = songs[index + 1];
        const songSelected = selection?.occurrence === song.occurrence;
        const name = song.title || 'Untitled';
        return (
          <li key={song.occurrence} className="lucy-song-slot">
            {previous && (
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
            <div className={`lucy-song ${songSelected ? 'is-selected' : ''} ${song.locked ? 'is-locked' : ''}`} data-occ={song.occurrence}>
              <span className="lucy-song-n" aria-hidden="true">{index + 1}</span>
              <div className="lucy-song-main">
                <p className="lucy-song-name"><span className="visually-hidden">Song {index + 1}: </span><b dir="auto">{name}</b> <span className="soft" dir="auto">{song.artist || 'Unknown artist'}</span></p>
                <p className="lucy-song-facts">
                  {song.duration > 0 ? clock(song.duration) : 'Length unknown'} · {bpmWords(song.bpm)} · {keyWords(song.key)} · {energyWords(song.energy)}
                  {song.locked && <> · <Icon name="lock" width={14} height={14} /> Locked</>}
                </p>
              </div>
              <div className="lucy-song-actions" role="group" aria-label={`Change ${name}`}>
                <button type="button" data-act="lock" aria-pressed={song.locked} aria-disabled={busy || !editable || undefined} title={blockedWords}
                  onClick={() => void change({ op: song.locked ? 'unlock' : 'lock', occurrence: song.occurrence }, { occurrence: song.occurrence, act: 'lock' })}>
                  {song.locked ? 'Unlock' : 'Lock'}
                </button>
                <button type="button" data-act="up" disabled={index === 0} aria-disabled={busy || !editable || undefined} aria-label={`Move ${name} up`} title={blockedWords}
                  onClick={() => void change({ op: 'move', occurrence: song.occurrence, to: index - 1 }, { occurrence: song.occurrence, act: 'up' })}>
                  <Icon name="up" />
                </button>
                <button type="button" data-act="down" disabled={!nextSong} aria-disabled={busy || !editable || undefined} aria-label={`Move ${name} down`} title={blockedWords}
                  onClick={() => void change({ op: 'move', occurrence: song.occurrence, to: index + 1 }, { occurrence: song.occurrence, act: 'down' })}>
                  <Icon name="down" />
                </button>
                <button type="button" data-act="remove" aria-disabled={busy || !editable || undefined} aria-label={`Remove ${name}`} title={blockedWords}
                  onClick={() => void change({ op: 'remove', occurrence: song.occurrence }, (nextSong ?? previous) ? { occurrence: (nextSong ?? previous).occurrence, act: 'remove' } : null)}>
                  <Icon name="trash" />
                </button>
                <button type="button" data-act="ask" className="quiet" aria-pressed={songSelected} aria-label={`Ask about ${name}`}
                  onClick={() => onAsk({ occurrence: song.occurrence }, name)}>
                  Ask about this
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
