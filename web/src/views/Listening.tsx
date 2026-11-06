import { FormEvent, useRef, useState } from 'react';
import { get, post } from '../api';
import { releaseAudio, takeAudio } from '../audio/focus';
import { Action } from '../ui/controls';

const TAGS = ['beat', 'downbeat', 'mid-vocal', 'key', 'energy', 'contrast', 'cut-off ending'];
const GRADES: [number, string][] = [[1, '1 · Bad'], [2, '2'], [3, '3'], [4, '4'], [5, '5 · Excellent']];
const CHOICES: [string, string][] = [['a', 'Prefer A'], ['b', 'Prefer B'], ['tie', 'No preference'], ['cannot_judge', 'Cannot judge']];

/** A blind comparison. Neither clip says what it is, one plays at a time, and an answer that fails to
 * save stays on screen with everything still filled in, ready to send again. */
export function Listening() {
  const [study, setStudy] = useState('');
  const [listener, setListener] = useState('');
  const [setup, setSetup] = useState('');
  const [trials, setTrials] = useState<{ id: string }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [heard, setHeard] = useState<string[]>([]);
  const [quality, setQuality] = useState<Record<string, { grade: number; tags: string[] }>>({});
  const players = { a: useRef<HTMLAudioElement>(null), b: useRef<HTMLAudioElement>(null) };
  const trial = trials?.[index];

  const load = async (event?: FormEvent) => {
    event?.preventDefault();
    setError('');
    try {
      setTrials(await get(`/listening?study=${encodeURIComponent(study)}`));
      setIndex(0);
      setHeard([]);
      setQuality({});
    } catch {
      setError('Could not load this listening study.');
    }
  };

  const answer = async (choice: string) => {
    if (!trial) return;
    setError('');
    players.a.current?.pause();
    players.b.current?.pause();
    try {
      // sending the same answer again, because the first reply got lost, doesn't count it twice
      await post(`/listening/${trial.id}/response`, { listener, setup, choice, quality }, { 'x-operation-id': `listening-${trial.id}-${listener}-${choice}` });
      setIndex(index + 1);
      setHeard([]);
      setQuality({});
    } catch {
      setError('Your response was not saved. Everything’s still here, so try again.');
    }
  };

  const toggleTag = (option: string, tag: string) => {
    setQuality((current) => {
      const tags = current[option]?.tags ?? [];
      return {
        ...current,
        [option]: { ...current[option], tags: tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag] },
      };
    });
  };

  return (
    <section className="panel stack">
      <h2>Blind listening comparison</h2>
      <p>Compare two versions without seeing the transition method. Listen to both, then choose your preference. A tie and “cannot judge” are both real answers.</p>
      <form className="stack" onSubmit={(event) => void load(event)}>
        <label>Study code<input value={study} onChange={(event) => setStudy(event.target.value)} required /></label>
        <label>Listener nickname<input value={listener} onChange={(event) => setListener(event.target.value)} required /></label>
        <label>Listening setup<input placeholder="For example, headphones in a quiet room" value={setup} onChange={(event) => setSetup(event.target.value)} required /></label>
        <button disabled={!study.trim() || !listener.trim() || !setup.trim()}>Open study</button>
      </form>
      {error && <p className="warn" role="alert">{error}</p>}
      {trial && (
        <div key={trial.id} className="stack">
          <p>Comparison {index + 1} of {trials!.length}</p>
          {(['a', 'b'] as const).map((option) => (
            <label key={option}>
              Version {option.toUpperCase()}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                ref={players[option]}
                controls
                preload="none"
                src={`/api/listening/${trial.id}/${option}/audio`}
                onPlay={() => {
                  takeAudio({ id: `listening-${option}`, label: 'A listening test', stop: () => players[option].current?.pause() });
                  setHeard((current) => (current.includes(option) ? current : [...current, option]));
                }}
                onPause={() => releaseAudio(`listening-${option}`)}
                onEnded={() => releaseAudio(`listening-${option}`)}
                onError={() => setError('A comparison clip is unavailable. You can record “cannot judge”.')}
              />
            </label>
          ))}
          {(['a', 'b'] as const).map((option) => (
            <fieldset key={option}>
              <legend>Version {option.toUpperCase()} quality</legend>
              <div className="chips" role="radiogroup" aria-label={`Quality of ${option.toUpperCase()}`}>
                {GRADES.map(([grade, words]) => (
                  <label className="choice" key={grade}>
                    <input
                      type="radio"
                      name={`grade-${option}`}
                      checked={quality[option]?.grade === grade}
                      onChange={() => setQuality((current) => ({ ...current, [option]: { grade, tags: current[option]?.tags ?? [] } }))}
                    />
                    {words}
                  </label>
                ))}
              </div>
              <div className="chips" role="group" aria-label={`Issues with ${option.toUpperCase()}, if any`}>
                {TAGS.map((tag) => (
                  <label className="choice" key={tag}>
                    <input
                      type="checkbox"
                      disabled={!quality[option]}
                      checked={quality[option]?.tags?.includes(tag) ?? false}
                      onChange={() => toggleTag(option, tag)}
                    />
                    {tag}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="chips" role="group" aria-label="Comparison preference">
            {CHOICES.map(([value, label]) => (
              <Action
                key={value}
                working="Saving…"
                disabled={!listener.trim() || !setup.trim() || (value !== 'cannot_judge' && heard.length < 2)}
                run={() => answer(value)}
              >
                {label}
              </Action>
            ))}
          </div>
          {heard.length < 2 && <p className="hint">Listen to both to choose between them.</p>}
        </div>
      )}
      {trials?.length === 0 && <p>No trials are registered for this study code.</p>}
      {!!trials?.length && index === trials.length && <p role="status">All responses saved. Thank you for listening.</p>}
    </section>
  );
}
