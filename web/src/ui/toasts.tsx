import { Icon } from './Icon';
import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { playExit } from './exitMotion';
import { createPortal } from 'react-dom';
import { canUndo, clearActivity, recordActivity, runUndo } from '../state/activity';
import { feelOn } from '../feel/root';

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
  /** UF-0380-07: the mix this change was made in, said on the toast itself, not only in Activity. */
  where?: string;
  /** Things to do about the news itself (a room request: Add next, Requests). Each runs once and
   * the toast goes; a failure is the action's own to say. Unlike Undo, nothing is kept in Activity. */
  actions?: ToastAction[];
  /** Something the person asked for has finished: with the feel's motion on, a tick draws itself
   * beside the words (ADR-0477). The words still say it. */
  success?: boolean;
};
export type ToastAction = { label: string; run: () => Promise<unknown> | void };

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

export function showToast(message: string, options: { undo?: Toast['undo']; tone?: ToastTone; scope?: string | null; where?: string; actions?: ToastAction[]; success?: boolean } = {}): number {
  const clean = message.replace(/\.\.$/, '.');
  const tone = options.tone ?? 'info';
  const key = `${options.scope ?? ''}\u0000${clean}`;
  if (tone === 'info' && !options.undo && !options.actions?.length) {
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
  const toast: Toast = { id: next++, message: clean, undo: options.undo, tone, activity, where: options.where || undefined, actions: options.actions?.length ? options.actions : undefined, ...(options.success && tone === 'info' ? { success: true } : {}) };
  const all = [...toasts, toast];
  // room is made from the oldest with no Undo first. One with an Undo can go too, because Activity has it.
  // UF-0371-07: routine news goes before a problem, so background completions never push an error away.
  while (all.length > SHOWN) {
    const routine = all.findIndex((item) => !item.undo && item.tone !== 'problem');
    const spare = routine >= 0 ? routine : all.findIndex((item) => !item.undo);
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

/** How far a toast has to be dragged sideways, as a share of its width, or how fast it has to be
 * flicked (px per ms over at least SWIPE_FLICK_PX), before letting go dismisses it. */
const SWIPE_SHARE = 0.35;
const SWIPE_SPEED = 0.5;
const SWIPE_FLICK_PX = 24;

/** `depth` is how many newer toasts sit in front of this one (0 for the newest); with the feel's depth
 * on, older ones sit back a little behind the newest, and come forward under the pointer or focus. */
function ToastRow({ toast, closing = false, onGone, depth = 0 }: { toast: Toast; closing?: boolean; onGone?: (id: number) => void; depth?: number }) {
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
  // The undo ring (ADR-0477): with the feel's motion on, a ring in the Undo button empties over the
  // real time left. Each start of the timer starts a new round of the ring at the same length; while
  // the timer is held (pointer or focus on the toast) the ring stands full, because the full time
  // starts again when it is let go.
  const ring = !!toast.undo && feelOn('motion');
  const [clock, setClock] = useState<{ round: number; wait: number } | null>(null);
  const start = () => {
    if (inFlight.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    const wait = toast.undo || toast.actions ? UNDO_MS : toast.tone === 'problem' ? PROBLEM_MS : PLAIN_MS;
    timer.current = window.setTimeout(() => dismissToast(toast.id), wait);
    if (ring) setClock((now) => ({ round: (now?.round ?? 0) + 1, wait }));
  };
  const hold = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (ring) setClock(null);
  };
  // Swipe or drag sideways to dismiss (ADR-0477), with the feel's motion on only. The toast follows
  // the pointer by its own translate, and springs back (styles/feel-components.css) when let go
  // short of the line. Presses on its buttons are never taken for a drag.
  const drag = useRef<{ x: number; at: number; pointer: number; dx: number } | null>(null);
  const dragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (closing || event.button !== 0 || !feelOn('motion') || (event.target as Element).closest('button, a, input')) return;
    drag.current = { x: event.clientX, at: event.timeStamp, pointer: event.pointerId, dx: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    hold();
  };
  const dragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const at = drag.current;
    const node = row.current;
    if (!at || at.pointer !== event.pointerId || !node) return;
    at.dx = event.clientX - at.x;
    node.setAttribute('data-dragging', '');
    node.style.translate = `${Math.round(at.dx)}px 0`;
    node.style.opacity = String(Math.max(0.3, 1 - Math.abs(at.dx) / Math.max(node.offsetWidth, 1)));
  };
  const dragEnd = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const at = drag.current;
    const node = row.current;
    if (!at || at.pointer !== event.pointerId || !node) return;
    drag.current = null;
    node.removeAttribute('data-dragging');
    const speed = Math.abs(at.dx) / Math.max(event.timeStamp - at.at, 1);
    const far = Math.abs(at.dx) > node.offsetWidth * SWIPE_SHARE || (speed > SWIPE_SPEED && Math.abs(at.dx) > SWIPE_FLICK_PX);
    if (!cancelled && far) {
      restoreFocus();
      dismissToast(toast.id);
      return;
    }
    node.style.translate = '';
    node.style.opacity = '';
    // a mouse still over the toast keeps holding it, as hovering always has
    if (event.pointerType !== 'mouse') start();
  };
  useEffect(() => {
    start();
    return hold;
  }, []);
  // On its way out (the exit-animation protocol): no timers, no focus, nothing to read, and gone once
  // its fade has played, or at once where nothing animates.
  useLayoutEffect(() => {
    if (!closing) return undefined;
    hold();
    const node = row.current;
    if (!node) {
      onGone?.(toast.id);
      return undefined;
    }
    return playExit(node, () => onGone?.(toast.id), '--motion-exit-toast');
  }, [closing]);
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
      className={`toast-row ${toast.tone}${toast.actions?.length ? ' with-actions' : ''}`}
      aria-busy={undoing || undefined}
      role={toast.tone === 'problem' ? 'alert' : 'status'}
      data-closing={closing ? '' : undefined}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      style={{ '--depth': depth } as CSSProperties}
      onMouseEnter={closing ? undefined : hold}
      onMouseLeave={closing ? undefined : start}
      onFocus={closing ? undefined : hold}
      onBlur={closing ? undefined : start}
      onPointerDown={dragStart}
      onPointerMove={dragMove}
      onPointerUp={(event) => dragEnd(event)}
      onPointerCancel={(event) => dragEnd(event, true)}
    >
      {toast.success && feelOn('motion') && (
        <svg className="toast-tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path className="feel-tick" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      )}
      <span>{toast.message}</span>
      {toast.where && <small className="toast-where">In {toast.where}.</small>}
      {toast.undo && (
        <button
          onClick={() => void undo()}
          aria-disabled={undoing || !canUndo(toast.activity) || undefined}
          title={canUndo(toast.activity) ? undefined : 'Undo the newer change first; this stays in Activity'}
        >
          {ring && !undoing && (
            <svg className="toast-ring" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <circle key={clock?.round ?? 0} className={clock ? 'toast-ring-left' : undefined} style={clock ? { animationDuration: `${clock.wait}ms` } : undefined} cx="10" cy="10" r="8" pathLength={1} />
            </svg>
          )}
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
      )}
      {toast.actions?.map((action) => (
        <button key={action.label} onClick={() => { restoreFocus(); dismissToast(toast.id); void action.run(); }}>{action.label}</button>
      ))}
      <button className="toast-close" aria-label="Dismiss" title="Dismiss" onClick={() => { restoreFocus(); dismissToast(toast.id); }}><Icon name="close" /></button>
    </div>
  );
}

/** Outside the page, so a message and its Undo stay usable while a dialog has the page inert. */
export function Toaster() {
  const shown = useSyncExternalStore(subscribe, () => toasts);
  // Toasts that have just been dismissed stay in place while they animate out, then go.
  const [leaving, setLeaving] = useState<Toast[]>([]);
  const before = useRef<Toast[]>(shown);
  useLayoutEffect(() => {
    const gone = before.current.filter((toast) => !shown.includes(toast));
    before.current = shown;
    if (gone.length) setLeaving((now) => [...now.filter((toast) => !shown.includes(toast)), ...gone.filter((toast) => !now.includes(toast))]);
  }, [shown]);
  const finished = (id: number) => setLeaving((now) => now.filter((toast) => toast.id !== id));
  const rows = [...shown.map((toast) => ({ toast, closing: false })), ...leaving.filter((toast) => !shown.includes(toast)).map((toast) => ({ toast, closing: true }))]
    .sort((a, b) => a.toast.id - b.toast.id);
  if (!rows.length) return null;
  const live = rows.filter((item) => !item.closing).map((item) => item.toast.id);
  return createPortal(
    <div className="toasts" aria-label="Notifications">
      {rows.map(({ toast, closing }) => <ToastRow key={toast.id} toast={toast} closing={closing} onGone={finished} depth={closing ? 0 : live.length - 1 - live.indexOf(toast.id)} />)}
    </div>,
    document.body,
  );
}
