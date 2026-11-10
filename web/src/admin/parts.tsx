import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Status } from '../ui/controls';
import { AdminError, age, Reading } from './adminApi';

/** A number with its freshness: fresh shows its age, stale says so, unknown withholds the value. */
export function Fresh({ reading, format = String }: { reading: Reading; format?: (value: number) => string }) {
  if (reading.state === 'unknown') {
    return <span className="admin-fresh unknown"><Status kind="unavailable">Unknown</Status><small>{reading.as_of === null ? 'never measured' : `last measured ${age(reading.age_s)}`}</small></span>;
  }
  return (
    <span className={`admin-fresh ${reading.state}`}>
      <strong>{reading.value === null ? 'n/a' : format(reading.value)}</strong>
      {reading.state === 'stale' ? <Status kind="warning">{`Stale: ${age(reading.age_s)}`}</Status> : <small>as of {age(reading.age_s)}</small>}
    </span>
  );
}

/**
 * A command button that asks for a reason first. Every admin command is audited with one, so the
 * button stays disabled until a reason is typed.
 */
export function Command({ label, run, danger, note }: { label: string; run: (reason: string) => Promise<unknown>; danger?: boolean; note?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await run(reason.trim()); setOpen(false); setReason(''); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  if (!open) return <button className={danger ? 'admin-danger' : undefined} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form className="admin-command" onSubmit={(event) => void submit(event)} aria-label={label}>
      {note && <p className="admin-note">{note}</p>}
      <label>Reason for “{label}”<input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={2000} autoFocus /></label>
      <button className={danger ? 'admin-danger' : 'primary'} disabled={busy || !reason.trim()}>{busy ? 'Working…' : label}</button>
      <button type="button" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
      {error && <p className="admin-error" role="alert">{error}</p>}
    </form>
  );
}

/** Load something once and on demand, keeping a refusal's words for the page. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setError('');
    try { setData(await load()); }
    catch (problem) { setError(problem instanceof AdminError ? problem.message : (problem as Error).message); }
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="admin-panel" aria-label={title}><div className="admin-panel-head"><h2>{title}</h2>{actions}</div>{children}</section>;
}

export function Failure({ error }: { error: string }) {
  return error ? <p className="admin-error" role="alert">{error}</p> : null;
}
