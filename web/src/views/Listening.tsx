import { FormEvent, useRef, useState } from 'react';
import { get, post } from '../api';

export function Listening() {
  const [study, setStudy] = useState('');
  const [listener, setListener] = useState('');
  const [setup, setSetup] = useState('');
  const [trials, setTrials] = useState<{ id: string }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [heard, setHeard] = useState<string[]>([]);
  const [quality, setQuality] = useState<Record<string, { grade: number; tags: string[] }>>({});
  const a = useRef<HTMLAudioElement>(null);
  const b = useRef<HTMLAudioElement>(null);
  const trial = trials?.[index];
  const load = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { setTrials(await get(`/listening?study=${encodeURIComponent(study)}`)); setIndex(0); setHeard([]); setQuality({}); }
    catch { setError('Could not load this listening study.'); }
    finally { setBusy(false); }
  };
  const answer = async (choice: string) => {
    if (!trial) return;
    setBusy(true); setError('');
    a.current?.pause(); b.current?.pause();
    try {
      await post(`/listening/${trial.id}/response`, { listener, setup, choice, quality });
      setIndex(index + 1); setHeard([]); setQuality({});
    } catch { setError('Your response was not saved. Try again.'); }
    finally { setBusy(false); }
  };
  return <section className="panel stack">
    <h2>Blind listening comparison</h2>
    <p>Compare two versions without seeing the transition method. Listen to both, then choose your preference. A tie and “cannot judge” are valid responses.</p>
    <form className="stack" onSubmit={(event) => void load(event)}>
      <label>Study code<input value={study} onChange={(event) => setStudy(event.target.value)} required /></label>
      <label>Listener nickname<input value={listener} onChange={(event) => setListener(event.target.value)} required /></label>
      <label>Listening setup<input placeholder="For example, headphones in a quiet room" value={setup} onChange={(event) => setSetup(event.target.value)} required /></label>
      <button disabled={busy || !study.trim() || !listener.trim() || !setup.trim()}>Open study</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {trial && <div key={trial.id} className="stack">
      <p>Comparison {index + 1} of {trials!.length}</p>
      {(['a', 'b'] as const).map((option) => <label key={option}>Version {option.toUpperCase()}
        <audio ref={option === 'a' ? a : b} controls preload="none" src={`/api/listening/${trial.id}/${option}/audio`} onPlay={() => {
          (option === 'a' ? b : a).current?.pause();
          setHeard((current) => current.includes(option) ? current : [...current, option]);
        }} onError={() => setError('A comparison clip is unavailable. You can record “cannot judge”.')} />
      </label>)}
      {(['a', 'b'] as const).map((option) => <fieldset key={option}>
        <legend>Version {option.toUpperCase()} quality</legend>
        <select aria-label={`Quality of ${option.toUpperCase()}`} value={quality[option]?.grade ?? ''} onChange={(event) => {
          const grade = Number(event.target.value);
          setQuality((current) => ({ ...current, [option]: { grade, tags: current[option]?.tags ?? [] } }));
        }}>
          <option value="" disabled>Rate from 1 to 5</option>
          {[1, 2, 3, 4, 5].map((grade) => <option key={grade} value={grade}>{grade}{grade === 1 ? ' · Bad' : grade === 5 ? ' · Excellent' : ''}</option>)}
        </select>
        <label>Issues, if any<select multiple aria-label={`Issues with ${option.toUpperCase()}`} disabled={!quality[option]} value={quality[option]?.tags ?? []} onChange={(event) => {
          const tags = Array.from(event.target.selectedOptions, (item) => item.value);
          setQuality((current) => ({ ...current, [option]: { ...current[option], tags } }));
        }}>
          {['beat', 'downbeat', 'mid-vocal', 'key', 'energy', 'contrast', 'cut-off ending'].map((tag) => <option key={tag}>{tag}</option>)}
        </select></label>
      </fieldset>)}
      <div className="chips" role="group" aria-label="Comparison preference">
        {[['a', 'Prefer A'], ['b', 'Prefer B'], ['tie', 'No preference'], ['cannot_judge', 'Cannot judge']].map(([value, label]) =>
          <button key={value} disabled={busy || !listener.trim() || !setup.trim() || (value !== 'cannot_judge' && heard.length < 2)} onClick={() => void answer(value)}>{label}</button>)}
      </div>
    </div>}
    {trials?.length === 0 && <p>No trials are registered for this study code.</p>}
    {!!trials?.length && index === trials.length && <p role="status">All responses saved. Thank you for listening.</p>}
  </section>;
}
