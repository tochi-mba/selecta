import { FormEvent, useEffect, useRef, useState } from 'react';
import { get, post } from '../api';
import { mainPlayerTouched, releaseAudio, takeAudio } from '../audio/focus';
import { Action } from '../ui/controls';
import { Field } from '../ui/primitives';

const TAGS = ['beat', 'downbeat', 'mid-vocal', 'key', 'energy', 'contrast', 'cut-off ending'];
const GRADES: [number, string][] = [[1, '1 · Bad'], [2, '2'], [3, '3'], [4, '4'], [5, '5 · Excellent']];
const CHOICES: [string, string][] = [['a', 'Prefer A'], ['b', 'Prefer B'], ['tie', 'No preference'], ['cannot_judge', 'Cannot judge']];
const VERSIONS = ['a', 'b'] as const;

/** A blind comparison. Neither clip says what it is, one plays at a time, and an answer that fails to
 * save stays on screen with everything still filled in, ready to send again. Nothing on this page, in
 * its words or its names for things, says how either version was made. */
export function Listening() {
  const [study, setStudy] = useState('');
  const [listener, setListener] = useState('');
  const [setup, setSetup] = useState('');
  const [trials, setTrials] = useState<{ id: string }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const operation = useRef(false);
  const [progressKey, setProgressKey] = useState('');
  const [heard, setHeard] = useState<string[]>([]);
  const [playing, setPlaying] = useState<'a' | 'b' | null>(null);
  const [quality, setQuality] = useState<Record<string, { grade: number; tags: string[] }>>({});
  const players = { a: useRef<HTMLAudioElement>(null), b: useRef<HTMLAudioElement>(null) };
  const trial = trials?.[index];
  useEffect(() => {
    if (!progressKey || !trials) return;
    try { sessionStorage.setItem(progressKey, JSON.stringify({ ids: trials.map((row) => row.id), index, quality, heard })); } catch { /* current answers remain in memory */ }
  }, [progressKey, trials, index, quality, heard]);
  useEffect(() => () => {
    // A stale event from the previous trial cannot release the new trial's
    // audio owner. Closing the study also cannot resume the main mix implicitly.
    mainPlayerTouched();
    players.a.current?.pause();
    players.b.current?.pause();
    releaseAudio(`listening-${trial?.id}-a`);
    releaseAudio(`listening-${trial?.id}-b`);
  }, [trial?.id]);

  const quiet = () => {
    players.a.current?.pause();
    players.b.current?.pause();
    setPlaying(null);
  };

  const load = async (event?: FormEvent) => {
    event?.preventDefault();
    if (operation.current) return;
    operation.current = true;
    setLoading(true);
    setError('');
    try {
      const rows = await get<{ id: string }[]>(`/listening?study=${encodeURIComponent(study)}`);
      quiet();
      const key = `selecta.study.${JSON.stringify([study, listener, setup])}`;
      let restored: { ids: string[]; index: number; quality: typeof quality; heard: string[] } | null = null;
      try { restored = JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { /* invalid cached progress is ignored */ }
      const valid = restored && JSON.stringify(restored.ids) === JSON.stringify(rows.map((row) => row.id)) && Number.isInteger(restored.index) && restored.index >= 0 && restored.index <= rows.length;
      setTrials(rows);
      setProgressKey(key);
      setIndex(valid ? restored!.index : 0);
      setHeard(valid && Array.isArray(restored!.heard) ? restored!.heard : []);
      setQuality(valid && restored!.quality && typeof restored!.quality === 'object' ? restored!.quality : {});
    } catch {
      setError('Could not load this listening study. Check the study code and try again.');
    } finally { operation.current = false; setLoading(false); }
  };

  const answer = async (choice: string) => {
    if (!trial || operation.current) return;
    operation.current = true;
    setSaving(true);
    setError('');
    quiet();
    try {
      // sending the same answer again, because the first reply got lost, doesn't count it twice
      await post(`/listening/${trial.id}/response`, { listener, setup, choice, quality }, { 'x-operation-id': `listening-${trial.id}-${listener}-${choice}` });
      setIndex(index + 1);
      setHeard([]);
      setQuality({});
    } catch {
      setError('Your response was not saved. Everything’s still here, so try again.');
    } finally { operation.current = false; setSaving(false); }
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

  const allDone = !!trials?.length && index === trials.length;
  return (
    <section className="panel stack study" aria-labelledby="study-title">
      <h2 id="study-title">Blind listening study</h2>
      <p>Compare two versions without seeing how either was made. Listen to both, then choose your preference. A tie and “cannot judge” are both real answers. One person’s ear on one setup says something about that comparison, and doesn’t prove a version is better for everyone.</p>
      <form className="stack study-setup" onSubmit={(event) => void load(event)}>
        <Field label="Study code" help="The code you were given for this study.">
          {(field) => <input {...field} value={study} onChange={(event) => setStudy(event.target.value)} required />}
        </Field>
        <Field label="Listener nickname" help="Any name you’ll use again, so your answers stay together.">
          {(field) => <input {...field} value={listener} onChange={(event) => setListener(event.target.value)} required />}
        </Field>
        <Field label="Listening setup">
          {(field) => <input {...field} placeholder="For example, headphones in a quiet room" value={setup} onChange={(event) => setSetup(event.target.value)} required />}
        </Field>
        <button disabled={loading || saving || !study.trim() || !listener.trim() || !setup.trim()} aria-busy={loading}>{loading ? 'Opening study…' : 'Open study'}</button>
      </form>
      {error && <p className="warn" role="alert">{error}</p>}
      {trial && (
        <div key={trial.id} className="stack study-trial">
          <p className="study-progress">Comparison {index + 1} of {trials!.length}</p>
          <p className="study-now" role="status">{playing ? `Now playing: Version ${playing.toUpperCase()}` : 'Nothing is playing'}</p>
          <div className="study-versions">
            {VERSIONS.map((option) => (
              <div className="study-version" key={option}>
                <h3>Version {option.toUpperCase()}</h3>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  ref={players[option]}
                  aria-label={`Version ${option.toUpperCase()}`}
                  controls
                  preload="none"
                  src={`/api/listening/${trial.id}/${option}/audio`}
                  onPlay={() => {
                    takeAudio({ id: `listening-${trial.id}-${option}`, label: 'A listening test', stop: () => players[option].current?.pause() });
                    setPlaying(option);
                  }}
                  onTimeUpdate={(event) => {
                    // Pressing Play does not prove anything was audible: an
                    // unavailable clip must not unlock a preference vote.
                    if (event.currentTarget.currentTime >= 0.5 && event.currentTarget.readyState >= 2) {
                      setHeard((current) => current.includes(option) ? current : [...current, option]);
                    }
                  }}
                  onPause={() => {
                    setPlaying((current) => (current === option ? null : current));
                    // going from one clip to the other, or stopping to think, doesn't bring the mix back in
                    mainPlayerTouched();
                    releaseAudio(`listening-${trial.id}-${option}`);
                  }}
                  onEnded={() => {
                    setPlaying((current) => (current === option ? null : current));
                    mainPlayerTouched();
                    releaseAudio(`listening-${trial.id}-${option}`);
                  }}
                  onError={() => {
                    setPlaying((current) => current === option ? null : current);
                    mainPlayerTouched();
                    releaseAudio(`listening-${trial.id}-${option}`);
                    setError('A comparison clip is unavailable. You can record “cannot judge”.');
                  }}
                />
                <fieldset>
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
              </div>
            ))}
          </div>
          <div className="chips study-choices" role="group" aria-label="Comparison preference">
            {CHOICES.map(([value, label]) => (
              <Action
                key={value}
                working="Saving…"
                disabled={saving || loading || !listener.trim() || !setup.trim() || (value !== 'cannot_judge' && heard.length < 2)}
                run={() => answer(value)}
              >
                {label}
              </Action>
            ))}
          </div>
          {heard.length < 2 && <p className="hint">Listen to both to choose between them.</p>}
          {heard.length < 2 && <p className="hint">If a clip won’t play, “Cannot judge” is still available.</p>}
        </div>
      )}
      {trials?.length === 0 && <p>No trials are registered for this study code.</p>}
      {allDone && (
        <div className="study-done" role="status">
          <p><b>All responses saved. Thank you for listening.</b></p>
          <p className="hint">You answered {trials!.length} comparison{trials!.length === 1 ? '' : 's'}.</p>
        </div>
      )}
    </section>
  );
}
