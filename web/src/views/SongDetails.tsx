import { useEffect, useRef, useState } from 'react';
import { LibrarySong, post } from '../api';
import { clock } from '../lib';
import { trackReadiness } from '../state/readiness';
import { Action, Sheet, Status } from '../ui/controls';
import { Field } from '../ui/primitives';
import { ViewProps } from './shared';

const LOWEST_TEMPO = 40;
const HIGHEST_TEMPO = 240;
const KEY_SHAPE = /^(1[0-2]|[1-9])[AB]$/;

/** Is this tempo acceptable? Says what's wrong if not. The server checks too. */
export function tempoProblem(text: string): string {
  if (!text.trim()) return '';
  const value = Number(text);
  if (!Number.isFinite(value) || value < LOWEST_TEMPO || value > HIGHEST_TEMPO) return `Tempo has to be between ${LOWEST_TEMPO} and ${HIGHEST_TEMPO}.`;
  return '';
}

export function keyProblem(text: string): string {
  if (!text.trim() || KEY_SHAPE.test(text.trim())) return '';
  return 'Key has to be like 8A or 11B.';
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
  const savedBpm = song.override_bpm ? String(song.override_bpm) : '';
  const savedKey = song.override_camelot ?? '';
  const [bpm, setBpm] = useState(savedBpm);
  const [camelot, setCamelot] = useState(savedKey);
  const [bpmError, setBpmError] = useState('');
  const [keyError, setKeyError] = useState('');
  const [problem, setProblem] = useState('');
  const bpmBox = useRef<HTMLInputElement>(null);
  const keyBox = useRef<HTMLInputElement>(null);
  const facts = trackReadiness(song);

  // the server has a newer answer, and nothing typed here is waiting to be saved
  const lastSaved = useRef({ bpm: savedBpm, key: savedKey });
  useEffect(() => {
    if (bpm === lastSaved.current.bpm && savedBpm !== bpm) setBpm(savedBpm);
    if (camelot === lastSaved.current.key && savedKey !== camelot) setCamelot(savedKey);
    lastSaved.current = { bpm: savedBpm, key: savedKey };
  }, [savedBpm, savedKey]);

  /** Whether it really worked, because nothing may be reported as saved if it wasn't. */
  const send = async (body: Record<string, unknown>, said: string): Promise<boolean> => {
    setProblem('');
    try {
      const answer = await post<{ redone: number }>(`/songs/${song.id}/correct`, body);
      onChanged();
      notify(answer.redone ? `${said} ${answer.redone} transition${answer.redone === 1 ? '' : 's'} with this song will be made again.` : said);
      return true;
    } catch (error) {
      setProblem((error as Error).message);
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
      ...(bpm ? { bpm: Number(bpm) } : {}),
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
      <p className="song-detail-artist">{song.artist ?? 'Unknown artist'}</p>
      <p><Status kind={facts.kind}>{facts.words}</Status></p>
      {facts.reason && <p className="hint">{facts.reason}</p>}
      <dl className="song-facts">
        <div><dt>Length</dt><dd>{clock(song.duration)}</dd></div>
        <div><dt>Tempo in use</dt><dd>{song.bpm ? `${Math.round(song.bpm)} BPM` : 'Not measured yet'}{song.override_bpm ? ' (your correction)' : ''}</dd></div>
        <div><dt>Tempo measured</dt><dd>{detectedTempo ? `${detectedTempo} BPM` : 'Not measured yet'}</dd></div>
        <div><dt>Key in use</dt><dd>{song.camelot ?? 'Not measured yet'}{song.override_camelot ? ' (your correction)' : ''}</dd></div>
        <div><dt>Key measured</dt><dd>{song.detected_camelot ?? 'Not measured yet'}</dd></div>
        <div><dt>Lyrics</dt><dd>{lyricWords(song.lyric_status)}</dd></div>
      </dl>
      <section className="stack">
        <h3>Correct it</h3>
        <p className="hint">If Selecta got something wrong. What it measured is kept, so this can be put back, and analysing the song again won’t lose it. Transitions with this song may be made again, using what you enter here.</p>
        <div className="correct-row">
          <Field label={`Tempo${detectedTempo ? ` (measured ${detectedTempo})` : ''}`} error={bpmError} help="Between 40 and 240 BPM" className="correct-field">
            {(field) => (
              <input
                {...field}
                ref={bpmBox}
                type="number"
                min={LOWEST_TEMPO}
                max={HIGHEST_TEMPO}
                step="0.1"
                value={bpm}
                onChange={(event) => { setBpm(event.target.value); setBpmError(''); }}
                placeholder={detectedTempo ? String(detectedTempo) : ''}
              />
            )}
          </Field>
          {detectedTempo && (
            <div className="row">
              <button onClick={() => useMeasuredTempo(2)}>Double</button>
              <button onClick={() => useMeasuredTempo(0.5)}>Half</button>
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
        {problem && <p className="warn" role="alert">{problem}</p>}
        <div className="row wrap">
          <Action className="primary" working="Saving…" disabled={bpm === savedBpm && camelot === savedKey} run={saveCorrection}>
            Save correction
          </Action>
          {(song.override_bpm || song.override_camelot) && (
            <Action run={async () => {
              if (await send({ clear: ['bpm', 'camelot'] }, 'Back to what Selecta measured.')) {
                setBpm('');
                setCamelot('');
              }
            }}>
              Use what was measured
            </Action>
          )}
        </div>
      </section>
      <section className="stack">
        <h3>How Selecta treats it</h3>
        <p className="hint">None of these move or delete your file. They only change what Selecta does with this song.</p>
        {!facts.setAside && (
          <div className="row wrap">
            <Action aria-pressed={song.priority} run={() => onPriority(song)} title="Prioritized songs are analysed first and their stem windows are protected from cache cleanup">
              {song.priority ? 'Priority: on' : 'Prioritize'}
            </Action>
            <Action aria-pressed={song.never} run={() => onNever(song)} title="Selecta won’t pick this when it builds a mix">
              {song.never ? 'Never: on' : 'Never play'}
            </Action>
          </div>
        )}
      </section>
      <section className="stack">
        <h3>Is it music?</h3>
        <p className="hint">Something set aside never gets analysed or mixed. Your file isn’t touched either way.</p>
        <div className="row wrap">
          {facts.setAside ? (
            <Action run={() => send({ is_music: true }, 'This counts as music now.')}>This is music</Action>
          ) : (
            <Action run={() => send({ is_music: false }, 'Set aside.')}>This isn’t music</Action>
          )}
          {song.music_override != null && <Action run={() => send({ clear: ['is_music'] }, 'Selecta will decide again next time it reads your folder.')}>Let Selecta decide</Action>}
        </div>
      </section>
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
