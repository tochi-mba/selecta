import { createContext, KeyboardEvent, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { ActionSpec, AdminError, AdminFetch, Me, pressKey } from './adminApi';

// The console's half of "hard to do harm by accident" (doc 07b §7B.7). The server enforces every
// rule; this makes them pleasant: view mode until "Make changes", Careful actions run at once with
// Undo for 10 seconds, Dangerous ones open a dialog that lists the consequences, needs a reason
// and the target typed, starts focus on Cancel and never confirms on Enter.

export type Toast = { id: number; text: string; undo?: () => Promise<unknown>; tone?: 'ok' | 'bad' };

type Ctx = {
  api: AdminFetch; me: Me; can: (permission: string) => boolean;
  changesUntil: number | null; makeChanges: () => Promise<void>; stopChanges: () => Promise<void>;
  needs: (permission: string) => string; spec: (id: string) => ActionSpec | undefined;
  toast: (toast: Omit<Toast, 'id'>) => void; ask: (request: DangerRequest) => void;
};

export const ConsoleContext = createContext<Ctx | null>(null);
export function useConsole() {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole outside the console');
  return ctx;
}

/** "Needs the Billing role": the roles that hold a permission, from the code's role matrix. */
export function needsWords(me: Me, permission: string) {
  const roles = Object.values(me.role_matrix ?? {}).filter((r) => r.permissions.includes(permission) && r.title !== 'Owner').map((r) => r.title);
  if (!roles.length) return 'Needs the Owner role';
  return `Needs the ${roles.slice(0, 3).join(', ')}${roles.length > 3 ? ' or another' : ''} role`;
}

export type DangerRequest = {
  action: string; title: string; button: string; consequences: string[]; confirmText: string;
  confirmLabel: string; reasons: string[]; irreversible: boolean; delayed?: boolean;
  run: (reason: string, confirm: string) => Promise<unknown>; done: string;
};

type Write = { path: string; method?: string; body?: Record<string, unknown> };

/** Send one console write with its own idempotency key, so a double press does one thing. */
export async function write<T>(api: AdminFetch, { path, method = 'POST', body }: Write): Promise<T> {
  return api<T>(path, { method, body: JSON.stringify(body ?? {}), headers: { 'Idempotency-Key': pressKey() } });
}

/**
 * A button for one console action. Disabled with the reason when the role lacks it ("Needs the
 * Billing role") or the console is in view mode; ignores clicks for 500 ms after it becomes
 * enabled, so a button appearing under the pointer is never pressed by accident.
 */
export function ActionButton({ permission, onPress, children, danger, label }: { permission: string; onPress: () => void; children: ReactNode; danger?: boolean; label?: string }) {
  const ctx = useConsole();
  const allowed = ctx.can(permission);
  const viewing = ctx.changesUntil === null;
  const enabledAt = useRef(0);
  const disabled = !allowed || viewing;
  const [pending, setPending] = useState(false);
  useEffect(() => { if (!disabled) enabledAt.current = Date.now(); }, [disabled]);
  const why = !allowed ? ctx.needs(permission) : viewing ? 'Press Make changes first' : undefined;
  return (
    <span className="admin-action">
      <button type="button" className={danger ? 'admin-danger' : undefined} aria-label={label} disabled={disabled || pending} aria-describedby={undefined} title={why}
        onClick={() => {
          if (Date.now() - enabledAt.current < 500) return;
          setPending(true); onPress(); window.setTimeout(() => setPending(false), 800);
        }}>{children}</button>
      {why && <small className="admin-soft">{why}</small>}
    </span>
  );
}

/** Run a Careful action: no dialog, a result line naming what happened, Undo for 10 seconds. */
export async function careful(ctx: Ctx, run: () => Promise<unknown>, done: string, undo?: () => Promise<unknown>) {
  try {
    await run();
    ctx.toast({ text: done, undo, tone: 'ok' });
    return true;
  } catch (problem) {
    ctx.toast({ text: problem instanceof AdminError ? problem.message : (problem as Error).message, tone: 'bad' });
    return false;
  }
}

/** The dialog for a Dangerous action (Vercel's and Supabase's destructive patterns). */
export function DangerDialog({ request, environment, onClose }: { request: DangerRequest; environment: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  const [armedAt] = useState(() => Date.now());
  useEffect(() => { cancel.current?.focus(); }, []);
  const ok = reason.trim().length > 0 && typed.trim().toLowerCase() === request.confirmText.trim().toLowerCase();
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    // Enter never confirms a dangerous dialog: only a click (or Space) on its button does.
    if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') event.preventDefault();
  };
  const proceed = async () => {
    if (!ok || busy || Date.now() - armedAt < 500) return;
    setBusy(true); setError('');
    try { await request.run(reason.trim(), typed.trim()); onClose(); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  const production = environment === 'production';
  return (
    <div className="admin-dialog-backdrop">
      <div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="danger-title" aria-describedby="danger-what" onKeyDown={keys}>
        <h2 id="danger-title">{request.title}{production && <span className="admin-badge bad">Production</span>}</h2>
        <div id="danger-what">
          <p>This will:</p>
          <ul>{request.consequences.map((line) => <li key={line}>{line}</li>)}</ul>
          {request.irreversible && <p className="admin-irreversible" role="note">This can’t be undone.</p>}
          {request.delayed && <p className="admin-soft">It waits 15 minutes before it runs, alerts every Owner, and can be cancelled until then.</p>}
        </div>
        <label>Reason (goes in the audit log)
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} list="danger-reasons" />
          <datalist id="danger-reasons">{request.reasons.map((r) => <option key={r} value={r} />)}</datalist>
        </label>
        <label>{request.confirmLabel}
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-dialog-buttons">
          <button ref={cancel} type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="admin-danger" disabled={!ok || busy} onClick={() => void proceed()}>{busy ? 'Working…' : request.button}</button>
        </div>
      </div>
    </div>
  );
}

/** Toasts sit at the bottom left, away from where a confirm button was, and are announced. */
export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="admin-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <p key={t.id} className={`admin-toast ${t.tone ?? ''}`}>
          {t.text}
          {t.undo && <button type="button" onClick={() => { const undo = t.undo!; dismiss(t.id); void undo(); }}>Undo</button>}
          <button type="button" className="quiet" aria-label="Dismiss" onClick={() => dismiss(t.id)}>Close</button>
        </p>
      ))}
    </div>
  );
}

export const REASONS = {
  support: ['Customer asked for it by email', 'Support case follow-up', 'Fixing a mistake we made'],
  abuse: ['Breach of the terms of use', 'Payment fraud suspected', 'Abuse report confirmed'],
  billing: ['Goodwill for an outage', 'Trial extension agreed', 'Payment issue being resolved'],
  staff: ['New staff member', 'Role no longer needed', 'Temporary cover'],
  incident: ['Incident in progress', 'Planned maintenance', 'Provider outage'],
};
