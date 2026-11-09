import { flagOn } from '../flags';
import { FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { problemKind } from '../api';
import { lucy } from '../lucy/client';
import type { LucyStatus, Memory, MemoryFact, MemoryKind } from '../lucy/types';
import { humanize, plural, valueWords, whenWords } from '../lucy/words';
import { Action, Problem, Skeleton } from '../ui/controls';

/** What Lucy remembers, where each thing came from and how sure it is, and a way to change or forget
 * any of it. It also shows exactly what an AI service would be given. */

const GROUPS: { kind: MemoryKind; title: string; empty: string }[] = [
  { kind: 'explicit', title: 'You told Lucy', empty: 'Nothing yet. Tell Lucy something below, or in a chat.' },
  { kind: 'inferred', title: 'Learned from listening', empty: 'Nothing learned yet.' },
  { kind: 'session', title: 'This conversation only', empty: 'Nothing held for a single conversation.' },
];

function sourceWords(source: Record<string, unknown>): string {
  return Object.entries(source ?? {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([name, value]) => `${humanize(name)}: ${valueWords(value)}`)
    .join(' · ');
}

function sureWords(confidence: number | null): string {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return '';
  return confidence <= 1 ? `${Math.round(confidence * 100)}% sure` : `Confidence ${confidence}`;
}

function FactRow({ fact, onChanged }: { fact: MemoryFact; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const inputId = useId();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (editing === null || !editing.trim()) return;
    await lucy.editFact(fact.id, editing.trim());
    setEditing(null);
    await onChanged();
  };
  const where = sourceWords(fact.source);
  const sure = sureWords(fact.confidence);
  return (
    <li className="lucy-fact">
      {editing === null ? (
        <>
          <p><b dir="auto">{fact.label || humanize(fact.subject)}</b>: <span dir="auto">{valueWords(fact.value)}</span></p>
          <p className="hint">{[where, sure, whenWords(fact.updated_at)].filter(Boolean).join(' · ') || 'Where this came from: unknown'}</p>
          <div className="row wrap">
            {fact.kind === 'explicit' && <button type="button" onClick={() => setEditing(valueWords(fact.value))}>Edit</button>}
            <Action working="Forgetting…" run={async () => { await lucy.forget(fact.id); await onChanged(); }}>Forget</Action>
          </div>
        </>
      ) : (
        <form className="row wrap" onSubmit={(event) => void save(event).catch(() => {})}>
          <label className="visually-hidden" htmlFor={inputId}>New value for {fact.label || fact.subject}</label>
          <input id={inputId} autoFocus value={editing} onChange={(event) => setEditing(event.target.value)} />
          <button type="submit" className="primary" disabled={!editing.trim()}>Save</button>
          <button type="button" onClick={() => setEditing(null)}>Cancel</button>
        </form>
      )}
    </li>
  );
}

export function LucyMemory({ onStatus }: { onStatus: (status: LucyStatus) => void }) {
  const ids = useId();
  const [memory, setMemory] = useState<Memory | null>(null);
  const [problem, setProblem] = useState('');
  const [subject, setSubject] = useState('');
  const [value, setValue] = useState('');
  const [clearing, setClearing] = useState<'inferred' | 'history' | null>(null);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      setMemory(await lucy.memory());
      setProblem('');
    } catch (error) {
      setProblem(problemKind(error) === 'offline' ? 'Can’t reach Selecta right now.' : (error as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remember = async (event: FormEvent) => {
    event.preventDefault();
    if (!subject.trim() || !value.trim()) return;
    await lucy.remember(subject.trim(), value.trim());
    setSubject('');
    setValue('');
    await load();
  };

  const clear = async (kind: 'inferred' | 'history') => {
    const answer = await lucy.clearMemory(kind);
    setClearing(null);
    setDone(kind === 'history' ? `Cleared ${plural(answer.cleared, 'listening record')}.` : `Forgot ${plural(answer.cleared, 'learned fact')}.`);
    await load();
  };

  return (
    <section className="lucy-memory" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`}>What Lucy remembers</h3>
      {problem && !memory && <Problem retry={load}>{problem}</Problem>}
      {!memory && !problem && <Skeleton lines={3} label="Reading what Lucy remembers" />}
      {memory && (
        <>
          {GROUPS.map((group) => {
            const facts = memory.facts.filter((fact) => fact.kind === group.kind);
            return (
              <div key={group.kind} className="lucy-memory-group">
                <h4>{group.title} <span className="soft">({facts.length})</span></h4>
                {facts.length ? <ul>{facts.map((fact) => <FactRow key={fact.id} fact={fact} onChanged={load} />)}</ul> : <p className="hint">{group.empty}</p>}
              </div>
            );
          })}
          <form className="lucy-remember" onSubmit={(event) => void remember(event).catch((error: Error) => setProblem(error.message))}>
            <p><b>Tell Lucy something to remember</b></p>
            <div className="row wrap">
              <label className="visually-hidden" htmlFor={`${ids}-subject`}>About</label>
              <input id={`${ids}-subject`} placeholder="About, for example: tempo" value={subject} onChange={(event) => setSubject(event.target.value)} />
              <label className="visually-hidden" htmlFor={`${ids}-value`}>What to remember</label>
              <input id={`${ids}-value`} placeholder="For example: I prefer slower mixes on Sundays" value={value} onChange={(event) => setValue(event.target.value)} />
              <button type="submit" disabled={!subject.trim() || !value.trim()}>Remember</button>
            </div>
          </form>

          {flagOn('lucy.listening_history') && <div className="lucy-memory-group">
            <h4>Listening history</h4>
            <label className="choice">
              <input type="checkbox" checked={memory.history.enabled} onChange={(event) => {
                // collecting listening history is Lucy's Memory and history switch on the server
                void lucy.saveSettings({ phases: { memory: event.target.checked } })
                  .then((next) => { onStatus(next); return load(); })
                  .catch((error: Error) => setProblem(error.message));
              }} />
              Keep a record of what I play and skip
            </label>
            <p className="hint">This is the same switch as Memory and history above.</p>
            <p className="hint">
              {plural(memory.history.events, 'listening record')}{memory.history.period ? ` over ${memory.history.period}` : ''}. Only the main player is recorded, never previews.
            </p>
            {memory.history.top.length > 0 && (
              <ol className="lucy-mini-list">
                {memory.history.top.map((song) => (
                  <li key={song.song_id}><span dir="auto">{song.title || 'Untitled'}</span> <span className="soft" dir="auto">{song.artist || 'Unknown artist'}</span> <span className="soft">· played {song.plays}, heard through {song.completes}, skipped {song.skips}</span></li>
                ))}
              </ol>
            )}
          </div>}

          <div className="row wrap lucy-clear">
            {(['inferred', 'history'] as const).map((kind) => (clearing === kind ? (
              <span key={kind} className="row wrap">
                <span>{kind === 'history' ? 'Clear every listening record?' : 'Forget everything Lucy learned from listening?'}</span>
                <Action className="destructive" working="Clearing…" run={() => clear(kind)}>Yes, clear it</Action>
                <button type="button" onClick={() => setClearing(null)}>Cancel</button>
              </span>
            ) : (
              <button key={kind} type="button" className="destructive" onClick={() => { setDone(''); setClearing(kind); }}>
                {kind === 'history' ? 'Clear listening history' : 'Clear learned taste'}
              </button>
            )))}
          </div>
          {done && <p className="hint" role="status">{done}</p>}
          {problem && <p className="warn" role="alert">{problem}</p>}

          <div className="lucy-memory-group">
            <h4>What a remote AI would receive</h4>
            {memory.provider_receives.length
              ? <ul>{memory.provider_receives.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p className="hint">Nothing. With the built-in planner, nothing leaves this computer.</p>}
          </div>
        </>
      )}
    </section>
  );
}
