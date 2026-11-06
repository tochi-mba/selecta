import { Icon } from './Icon';
import { useEffect, useRef, useSyncExternalStore } from 'react';

/** What's been said lately. A message with an Undo stays until its time is up however many others
 * arrive, because losing the way back from a mistake to a passing message is worse than a crowded
 * corner of the screen. Each Undo knows exactly what it undoes, whatever is on screen by then. */

export type ToastTone = 'info' | 'problem';
export type Toast = {
  id: number;
  message: string;
  undo?: () => Promise<unknown> | void;
  tone: ToastTone;
};

const SHOWN = 3;
const PLAIN_MS = 4500;
const PROBLEM_MS = 8000;

let next = 1;
let toasts: Toast[] = [];
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

export function showToast(message: string, options: { undo?: Toast['undo']; tone?: ToastTone } = {}): number {
  const clean = message.replace(/\.\.$/, '.');
  // the same words again just means the same thing is still true
  const same = toasts.find((toast) => toast.message === clean && !toast.undo && !options.undo);
  if (same) return same.id;
  const toast: Toast = { id: next++, message: clean, undo: options.undo, tone: options.tone ?? 'info' };
  const all = [...toasts, toast];
  // make room by dropping the oldest that nothing depends on
  while (all.length > SHOWN) {
    const spare = all.findIndex((item) => !item.undo);
    if (spare < 0) break;
    all.splice(spare, 1);
  }
  toasts = all;
  changed();
  return toast.id;
}

export function showProblem(message: string): number {
  return showToast(message, { tone: 'problem' });
}

export function clearToasts() {
  toasts = [];
  changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ToastRow({ toast }: { toast: Toast }) {
  const timer = useRef<number | null>(null);
  const start = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (toast.undo) return;
    const wait = toast.tone === 'problem' ? PROBLEM_MS : PLAIN_MS;
    timer.current = window.setTimeout(() => dismissToast(toast.id), wait);
  };
  const hold = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    if (!toast.undo) start();
    return hold;
  }, []);
  const undo = async () => {
    dismissToast(toast.id);
    try {
      await toast.undo?.();
    } catch (error) {
      showProblem((error as Error).message || 'Couldn’t undo that.');
    }
  };
  return (
    <div
      className={`toast-row ${toast.tone}`}
      role={toast.tone === 'problem' ? 'alert' : 'status'}
      onMouseEnter={hold}
      onMouseLeave={start}
      onFocus={hold}
      onBlur={start}
    >
      <span>{toast.message}</span>
      {toast.undo && <button onClick={() => void undo()}>Undo</button>}
      <button className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}><Icon name="close" /></button>
    </div>
  );
}

export function Toaster() {
  const shown = useSyncExternalStore(subscribe, () => toasts);
  if (!shown.length) return null;
  return (
    <div className="toasts" aria-label="Notifications">
      {shown.map((toast) => <ToastRow key={toast.id} toast={toast} />)}
    </div>
  );
}
