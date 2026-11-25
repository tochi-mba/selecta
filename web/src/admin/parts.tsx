import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
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

export const COMMAND_LIMIT_MS = 60_000;
const COMMAND_TOO_LONG = 'SelectaDJ didn’t answer in time. The change may still have been made: reload this page to check before trying again.';

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
    // A command that never answers must not hold Working... for ever. After the limit the button is
    // free again and the words say the change may still have landed, so staff check before repeating.
    let over = false;
    const slow = window.setTimeout(() => { over = true; setBusy(false); setError(COMMAND_TOO_LONG); }, COMMAND_LIMIT_MS);
    try { await run(reason.trim()); setOpen(false); setReason(''); setError(''); }
    catch (problem) { if (!over) setError((problem as Error).message); }
    finally { window.clearTimeout(slow); setBusy(false); }
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

const READ_LIMIT_MS = 20_000;
const READ_TOO_LONG = 'SelectaDJ is taking too long to respond. Try again.';

/** Load something once and on demand, keeping a refusal's words for the page. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  // Only the newest load may land: an older answer arriving late must not overwrite it.
  const latest = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    setError('');
    // A read that never answers must not leave a skeleton for ever: after the limit it says so and
    // offers Try again. An answer that comes later still lands.
    const slow = window.setTimeout(() => { if (mine === latest.current) setError(READ_TOO_LONG); }, READ_LIMIT_MS);
    try { const next = await load(); if (mine === latest.current) { setData(next); setError(''); } }
    catch (problem) { if (mine === latest.current) setError(problem instanceof AdminError ? problem.message : (problem as Error).message); }
    finally { window.clearTimeout(slow); }
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
