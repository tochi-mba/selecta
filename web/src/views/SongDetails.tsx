import { flagOn } from '../flags';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LibrarySong, post } from '../api';
import { clock } from '../lib';
import { capabilities } from '../state/capabilities';
import { trackReadiness } from '../state/readiness';
import { Action, Sheet, Status } from '../ui/controls';
import { Field } from '../ui/primitives';
import { SongMotif } from '../ui/MusicObjects';
import { SongRelated } from './SongRelated';
import { ViewProps } from './shared';

const LOWEST_TEMPO = 40;
const HIGHEST_TEMPO = 240;
const KEY_SHAPE = /^(1[0-2]|[1-9])[AB]$/;

/** S4-0106-03: a tempo as typed, in either decimal separator: "120,5" in a German browser and "120.5"
 * in an English one are both 120.5. Anything else (letters, two separators, thousands groups) is NaN, so
 * it is refused rather than read as something else: "120,5" must never become 1205. */
export function parseDecimal(text: string): number {
  const plain = text.trim().replace(/\s/g, '');
  if (!/^\d+(?:[.,]\d+)?$/.test(plain)) return Number.NaN;
  return Number(plain.replace(',', '.'));
}

/** A number shown the way this browser's language writes it: 120,5 in German, 120.5 in English. */
export function localDecimal(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, useGrouping: false }).format(value);
}

/** Is this tempo acceptable? Says what's wrong if not. The server checks too. */
export function tempoProblem(text: string): string {
  if (!text.trim()) return '';
  const value = parseDecimal(text);
  if (!Number.isFinite(value) || value < LOWEST_TEMPO || value > HIGHEST_TEMPO) return `Tempo has to be between ${LOWEST_TEMPO} and ${HIGHEST_TEMPO}.`;
  return '';
}

export function keyProblem(text: string): string {
  if (!text.trim() || KEY_SHAPE.test(text.trim())) return '';
  return 'Key has to be like 8A or 11B.';
}

/** LX-0348-04: what can usefully be done about a song's state, true to what Selecta can actually do. */
export function nextStep(status: string | undefined): string {
  switch (status) {
    case 'needs_attention': return 'Try analysing it again from its row in the Library. If it fails again the file may be damaged; replacing it with a good copy can help.';
    case 'missing': return 'Put the file back where it was, or check your music folders in Workshop. SelectaDJ never moves or deletes your files.';
    case 'queued': return 'Nothing to do: it’s in line and will be analysed in the background.';
    case 'processing': return 'Nothing to do: it’s being analysed now.';
    case 'excluded': return 'Turn off Never play to let mixes pick it again.';
    case 'set_aside': return 'If this is music, it can be counted as music again; your file was never touched.';
    case 'analysed_incomplete': return 'It can still be added to a mix by hand.';
    default: return '';
  }
}

const lyricWords = (status: string | null) => (status === 'synced' ? 'Timed' : status === 'instrumental' ? 'Instrumental' : status ? 'Not timed' : 'Not looked up yet');

/** Everything about one song, and the only place its details are worked out. The badge and the buttons
 * come from the same answer, and what was measured stays separate from what's in use, so a correction
 * can always be seen for what it is and taken back. */
export function SongDetails({ song, onClose, onChanged, notify, onPriority, onNever }: {
  song: LibrarySong;
  onClose: () => void;
  onChanged: () => void;
  notify: ViewProps['notify'];
  onPriority: (song: LibrarySong) => Promise<void>;
  onNever: (song: LibrarySong) => Promise<void>;
}) {
  const savedBpm = song.override_bpm ? localDecimal(song.override_bpm) : '';
  const savedKey = song.override_camelot ?? '';
  const [bpm, setBpm] = useState(savedBpm);
  const [camelot, setCamelot] = useState(savedKey);
  const [bpmError, setBpmError] = useState('');
  const [keyError, setKeyError] = useState('');
  const [problem, setProblem] = useState('');
  const bpmBox = useRef<HTMLInputElement>(null);
  const keyBox = useRef<HTMLInputElement>(null);
  const problemBox = useRef<HTMLParagraphElement>(null);
  const facts = trackReadiness(song);

  // the server has a newer answer, and nothing typed here is waiting to be saved
  const lastSaved = useRef({ bpm: savedBpm, key: savedKey });
  useEffect(() => {
    if (bpm === lastSaved.current.bpm && savedBpm !== bpm) setBpm(savedBpm);
    if (camelot === lastSaved.current.key && savedKey !== camelot) setCamelot(savedKey);
    lastSaved.current = { bpm: savedBpm, key: savedKey };
  }, [savedBpm, savedKey]);

  // The alert only exists after React commits the failed-save state. Focus it at that
  // point, not in a separate animation frame that may never run on a busy or hidden tab.
  // LX-0349-06: preserve edited fields and put keyboard focus on the failure.
  useLayoutEffect(() => {
    if (problem) problemBox.current?.focus();
  }, [problem]);

  /** Whether it really worked, because nothing may be reported as saved if it wasn't. */
  const send = async (body: Record<string, unknown>, said: string): Promise<boolean> => {
    setProblem('');
    try {
      const answer = await post<{ redone: number }>(`/songs/${song.id}/correct`, body);
      onChanged();
      notify(answer.redone ? `${said} ${answer.redone} transition${answer.redone === 1 ? '' : 's'} with this song will be made again.` : said);
      return true;
    } catch (error) {
      setProblem((error as Error).message || 'That didn’t save. What you typed is still here.');
      return false;
    }
  };
  const saveCorrection = async () => {
    const tempoWrong = tempoProblem(bpm);
    const keyWrong = keyProblem(camelot);
    setBpmError(tempoWrong);
    setKeyError(keyWrong);
    if (tempoWrong || keyWrong) {
      // focus goes to what needs fixing, with what was typed still there
      (tempoWrong ? bpmBox : keyBox).current?.focus();
      return;
    }
    await send({
      ...(bpm ? { bpm: parseDecimal(bpm) } : {}),
      ...(camelot ? { camelot: camelot.trim() } : {}),
      clear: [...(bpm ? [] : ['bpm']), ...(camelot ? [] : ['camelot'])],
    }, 'Saved your correction.');
  };
  const detectedTempo = song.detected_bpm ? Math.round(song.detected_bpm) : null;
  const useMeasuredTempo = (factor: number) => {
    const next = String(Math.round((song.detected_bpm ?? 0) * factor));
    setBpm(next);
    // A measured tempo at the edge may have a half/double outside the
    // permitted correction range. Show the problem immediately, not at Save.
    setBpmError(tempoProblem(next));
  };
  return (
    <Sheet title={song.title ?? 'Untitled'} onClose={onClose}>
      <div className="song-details-identity">
        <SongMotif songId={song.id} />
        <div>
          <p className="song-detail-artist" dir="auto">{song.artist ?? 'Unknown artist'}</p>
          <p className="song-details-id">Recording ID {song.id}</p>
        </div>
      </div>
      <p><Status kind={facts.kind}>{facts.words}</Status></p>
      {facts.reason && <p className="hint">{facts.reason}</p>}
      {nextStep(song.readiness?.status) && <p className="hint song-next-step">{nextStep(song.readiness?.status)}</p>}
      {flagOn('library.capability_readiness') && (
        <dl className="song-facts song-capabilities" aria-label="What it’s ready for">
          {capabilities(song, { lyrics: flagOn('lyrics.lookup') }).map((item) => (
            <div key={item.name}><dt>{item.name}</dt><dd><Status kind={item.kind}>{item.words}</Status></dd></div>
          ))}
        </dl>
      )}
      <dl className="song-facts song-facts-table">
        <div><dt>Length</dt><dd>{clock(song.duration)}</dd></div>
        <div><dt>Tempo in use</dt><dd>{song.bpm ? `${Math.round(song.bpm)} BPM` : 'Not measured yet'}{song.override_bpm ? ' (your correction)' : ''}</dd></div>
        <div><dt>Tempo measured</dt><dd>{detectedTempo ? `${detectedTempo} BPM` : 'Not measured yet'}</dd></div>
        <div><dt>Key in use</dt><dd>{song.camelot ?? 'Not measured yet'}{song.override_camelot ? ' (your correction)' : ''}</dd></div>
        <div><dt>Key measured</dt><dd>{song.detected_camelot ?? 'Not measured yet'}</dd></div>
        {flagOn('lyrics.lookup') && <div><dt>Lyrics</dt><dd>{lyricWords(song.lyric_status)}</dd></div>}
      </dl>
      {flagOn('library.related_links') && <SongRelated song={song} />}
      {flagOn('library.corrections') && (
      <section className="stack">
        <h3>Correct it</h3>
        <p className="hint">If SelectaDJ got something wrong. What it measured is kept, so this can be put back, and analysing the song again won’t lose it. Transitions with this song may be made again, using what you enter here.</p>
        <div className="correct-row">
          <Field label={`Tempo${detectedTempo ? ` (measured ${detectedTempo})` : ''}`} error={bpmError} help="Between 40 and 240 BPM" className="correct-field">
            {(field) => (
              <input
                {...field}
                ref={bpmBox}
                // text, not number: a number box in a German browser dropped the comma from "120,5"
                // and sent 1205 (S4-0106-03); this one takes either separator and checks the range itself
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={bpm}
                onChange={(event) => { setBpm(event.target.value); setBpmError(''); }}
                placeholder={detectedTempo ? String(detectedTempo) : ''}
              />
            )}
          </Field>
          {detectedTempo && (
            <div className="row">
              <button type="button" aria-label={`Double measured tempo to ${Math.round((song.detected_bpm ?? 0) * 2)} BPM`} onClick={() => useMeasuredTempo(2)}>Double measured</button>
              <button type="button" aria-label={`Half measured - set tempo to ${Math.round((song.detected_bpm ?? 0) / 2)} BPM`} onClick={() => useMeasuredTempo(0.5)}>Half measured</button>
            </div>
          )}
        </div>
        <Field label={`Key${song.detected_camelot ? ` (measured ${song.detected_camelot})` : ''}`} error={keyError} help="Like 8A or 11B" className="correct-field">
          {(field) => (
            <input
              {...field}
              ref={keyBox}
              value={camelot}
              onChange={(event) => { setCamelot(event.target.value.toUpperCase()); setKeyError(''); }}
              placeholder={song.detected_camelot ?? '8A'}
              maxLength={3}
            />
          )}
        </Field>
        {problem && <p className="warn" role="alert" tabIndex={-1} ref={problemBox}>{problem}</p>}
        <div className="row wrap">
          <Action className="primary" working="Saving…" disabled={bpm === savedBpm && camelot === savedKey} run={saveCorrection}>
            Save correction
          </Action>
          {(song.override_bpm || song.override_camelot) && (
            <Action run={async () => {
              if (await send({ clear: ['bpm', 'camelot'] }, 'Back to what SelectaDJ measured.')) {
                setBpm('');
                setCamelot('');
              }
            }}>
              Use what was measured
            </Action>
          )}
        </div>
      </section>
      )}
      {!facts.setAside && (flagOn('library.priority') || flagOn('library.never_play')) && (
      <section className="stack">
        <h3>How SelectaDJ treats it</h3>
        <p className="hint">None of these move or delete your file. They only change what SelectaDJ does with this song.</p>
        <div className="row wrap">
          {flagOn('library.priority') && (
            <Action aria-pressed={song.priority} run={() => onPriority(song)} title="Prioritized songs are analysed first and their stem windows are protected from cache cleanup">
              {song.priority ? 'Priority: on' : 'Prioritize'}
            </Action>
          )}
          {flagOn('library.never_play') && (
            <Action aria-pressed={song.never} run={() => onNever(song)} title="SelectaDJ won’t pick this when it builds a mix">
              {song.never ? 'Never: on' : 'Never play'}
            </Action>
          )}
        </div>
      </section>
      )}
      {flagOn('library.corrections') && (
      <section className="stack">
        <h3>Is it music?</h3>
        <p className="hint">Something set aside never gets analysed or mixed. Your file isn’t touched either way.</p>
        <div className="row wrap">
          {facts.setAside ? (
            <Action run={() => send({ is_music: true }, 'This counts as music now.')}>This is music</Action>
          ) : (
            <Action run={() => send({ is_music: false }, 'Set aside.')}>This isn’t music</Action>
          )}
          {song.music_override != null && <Action run={() => send({ clear: ['is_music'] }, 'SelectaDJ will decide again next time it reads your folder.')}>Let SelectaDJ decide</Action>}
        </div>
      </section>
      )}
      <details className="song-advanced">
        <summary>Advanced</summary>
        <dl className="song-facts">
          {song.grid_confidence != null && <div><dt>Beat grid</dt><dd>{Math.round(song.grid_confidence * 100)}% sure</dd></div>}
          {song.energy != null && <div><dt>Energy, as measured</dt><dd>{song.energy.toFixed(2)}</dd></div>}
          {song.genre && <div><dt>Genre tag</dt><dd>{song.genre}</dd></div>}
          <div><dt>Readiness</dt><dd>{song.readiness?.status ?? 'unknown'}</dd></div>
          <div><dt>Song number</dt><dd>{song.id}</dd></div>
        </dl>
      </details>
    </Sheet>
  );
}
