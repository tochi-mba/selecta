import { Icon } from './Icon';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { canUndo, clearActivity, recordActivity, runUndo } from '../state/activity';

/** What's been said lately. A toast confirms something once and then goes, and never holds the only
 * way back: anything that can be undone is also kept in Activity, so its Undo is still there after
 * the message has gone. Each Undo knows exactly what it undoes, whatever is on screen by then. */

export type ToastTone = 'info' | 'problem';
export type Toast = {
  id: number;
  message: string;
  undo?: () => Promise<unknown> | void;
  tone: ToastTone;
  activity: number;
};

const SHOWN = 3;
const PLAIN_MS = 4500;
const PROBLEM_MS = 8000;
const UNDO_MS = 15000;

let next = 1;
let toasts: Toast[] = [];
let quiet = false;
// Repeating non-actionable updates belong in Activity once, not in the foreground
// every time a poll finishes. Errors and anything with Undo are never suppressed.
const recentRoutine = new Map<string, { at: number; id: number }>();
const ROUTINE_WINDOW_MS = 30000;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  const left = toasts.filter((toast) => toast.id !== id);
  if (left.length === toasts.length) return;
  toasts = left;
  changed();
}

/** On the Stage, nothing but a real problem interrupts. The rest waits in Activity. */
export function setToastsQuiet(on: boolean) {
  quiet = on;
  if (on) {
    toasts = toasts.filter((toast) => toast.tone === 'problem');
    changed();
  }
}

export function showToast(message: string, options: { undo?: Toast['undo']; tone?: ToastTone; scope?: string | null } = {}): number {
  const clean = message.replace(/\.\.$/, '.');
  const tone = options.tone ?? 'info';
  const key = `${options.scope ?? ''}\u0000${clean}`;
  if (tone === 'info' && !options.undo) {
    const recent = recentRoutine.get(key);
    if (recent && Date.now() - recent.at < ROUTINE_WINDOW_MS) return recent.id;
  }
  // A still-visible repeat is the same message, but an actionable failure
  // must remain visible if it happens again after being dismissed.
  const same = toasts.find((toast) => toast.message === clean && toast.tone === tone && !toast.undo && !options.undo);
  if (same) return same.id;
  const activity = recordActivity(clean, { tone, scope: options.scope, undo: options.undo });
  if (tone === 'info' && !options.undo) {
    if (recentRoutine.size >= 64) recentRoutine.delete(recentRoutine.keys().next().value!);
    recentRoutine.set(key, { at: Date.now(), id: -activity });
  }
  if (quiet && tone !== 'problem') return -activity;
  const toast: Toast = { id: next++, message: clean, undo: options.undo, tone, activity };
  const all = [...toasts, toast];
  // room is made from the oldest with no Undo first. One with an Undo can go too, because Activity has it
  while (all.length > SHOWN) {
    const spare = all.findIndex((item) => !item.undo);
    all.splice(spare < 0 ? 0 : spare, 1);
  }
  toasts = all;
  if (tone === 'info' && !options.undo) recentRoutine.set(key, { at: Date.now(), id: toast.id });
  changed();
  return toast.id;
}

export function showProblem(message: string): number {
  return showToast(message, { tone: 'problem' });
}

export function clearToasts() {
  toasts = [];
  quiet = false;
  recentRoutine.clear();
  clearActivity();
  changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ToastRow({ toast }: { toast: Toast }) {
  const row = useRef<HTMLDivElement>(null);
  // When Undo or Dismiss removes the focused button, return to the nearest
  // active overlay rather than abandoning keyboard focus on document.body.
  const restoreFocus = () => {
    if (!row.current?.contains(document.activeElement)) return;
    const overlays = [...document.querySelectorAll<HTMLElement>('.overlay-panel')]
      .filter((panel) => !panel.closest('[inert]'));
    const target = overlays.at(-1) ?? document.getElementById('content');
    target?.focus({ preventScroll: true });
  };
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const [undoing, setUndoing] = useState(false);
  const start = () => {
    if (inFlight.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    const wait = toast.undo ? UNDO_MS : toast.tone === 'problem' ? PROBLEM_MS : PLAIN_MS;
    timer.current = window.setTimeout(() => dismissToast(toast.id), wait);
  };
  const hold = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    start();
    return hold;
  }, []);
  const undo = async () => {
    // The toast is an opportunity to undo, not permission to reverse an
    // unrelated newer edit. If blocked, keep this action in place and say why.
    if (!canUndo(toast.activity)) {
      showProblem('Undo the newer change in this mix first. Your earlier Undo is kept in Activity.');
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setUndoing(true);
    hold();
    try {
      await runUndo(toast.activity);
      // Keep Undo and its scope visible until the server confirms the change.
      restoreFocus();
      dismissToast(toast.id);
    } catch (error) {
      showProblem((error as Error).message || 'Couldn’t undo that.');
      setUndoing(false);
    } finally {
      inFlight.current = false;
      start();
    }
  };
  return (
    <div
      ref={row}
      className={`toast-row ${toast.tone}`}
      aria-busy={undoing || undefined}
      role={toast.tone === 'problem' ? 'alert' : 'status'}
      onMouseEnter={hold}
      onMouseLeave={start}
      onFocus={hold}
      onBlur={start}
    >
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          onClick={() => void undo()}
          aria-disabled={undoing || !canUndo(toast.activity) || undefined}
          title={canUndo(toast.activity) ? undefined : 'Undo the newer change first; this stays in Activity'}
        >{undoing ? 'Undoing…' : 'Undo'}</button>
      )}
      <button className="toast-close" aria-label="Dismiss" onClick={() => { restoreFocus(); dismissToast(toast.id); }}><Icon name="close" /></button>
    </div>
  );
}

/** Outside the page, so a message and its Undo stay usable while a dialog has the page inert. */
export function Toaster() {
  const shown = useSyncExternalStore(subscribe, () => toasts);
  if (!shown.length) return null;
  return createPortal(
    <div className="toasts" aria-label="Notifications">
      {shown.map((toast) => <ToastRow key={toast.id} toast={toast} />)}
    </div>,
    document.body,
  );
}
