import { useEffect, useRef, useState } from 'react';
import { announce } from '../ui/controls';

/** Lucy's usage as the server works it out (ADR-0484): one read model, drawn the same way by Lucy's
 * settings, Plan & billing and the twin level meter. The page only draws what it is given: the share
 * left, a state and the reset time already in words. It never works out usage for itself, and it
 * never shows what is behind the share. */

export type LucyWindow = { left: number; state: 'ok' | 'near' | 'spent'; resets_at: number | null; back_words: string | null; segments: number; open?: boolean };
export type LucyWindows = { session: LucyWindow | null; week: LucyWindow; lighter?: boolean; extra?: { left: number } | null };
export type LucyWindowKind = 'session' | 'week';
export type LucyUsageLine = { kind: LucyWindowKind; name: string; window: LucyWindow };

/** Said on `window` when the server says Lucy's usage moved (topic `lucy.usage`): read it again. */
export const LUCY_USAGE_EVENT = 'selecta:lucy-usage';

/** How many segments a ladder has (ADR-0484 rule 11). */
export const LADDER_SEGMENTS = 5;

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

const whole = (value: unknown, top: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(top, Math.max(0, Math.round(value))) : 0);

/** A session nobody has started yet: it is shown as full, with no reset time to give. */
export function notStarted(window: LucyWindow, kind: LucyWindowKind = 'session'): boolean {
  return kind === 'session' && (window.open === false || window.resets_at === null);
}

/** "72% left". */
export function leftWords(window: LucyWindow): string {
  return `${whole(window.left, 100)}% left`;
}

const CLOCK_ONLY = /^\d{1,2}[:.]\d{2}$/;

/** "at 16:40" for a time today, "Thursday 09:00" for a later day: the server's own words, joined on. */
export function whenWords(back: string | null): string {
  const words = (back ?? '').trim();
  if (!words) return '';
  return CLOCK_ONLY.test(words) ? `at ${words}` : words;
}

/** "back at 16:40", "back Thursday 09:00", or "not started" for a session that is not open yet. */
export function backWords(window: LucyWindow, kind: LucyWindowKind = 'session'): string {
  if (notStarted(window, kind)) return 'not started';
  const when = whenWords(window.back_words);
  return when ? `back ${when}` : '';
}

/** The state in words, so near and spent never rest on colour ('' while there is plenty left). */
export function stateWords(state: LucyWindow['state']): string {
  return state === 'near' ? 'Nearly used up' : state === 'spent' ? 'Used up' : '';
}

/** "72% left, back at 16:40": what a bar says aloud and what the small label shows. */
export function lineWords(window: LucyWindow, kind: LucyWindowKind = 'session'): string {
  return [leftWords(window), backWords(window, kind)].filter(Boolean).join(', ');
}

function windowOf(value: unknown, kind: LucyWindowKind): LucyWindow | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<LucyWindow>;
  if (typeof raw.left !== 'number') return null;
  const window: LucyWindow = {
    left: whole(raw.left, 100),
    state: raw.state === 'near' || raw.state === 'spent' ? raw.state : 'ok',
    resets_at: typeof raw.resets_at === 'number' ? raw.resets_at : null,
    back_words: typeof raw.back_words === 'string' && raw.back_words.trim() ? raw.back_words.trim() : null,
    segments: whole(raw.segments, LADDER_SEGMENTS),
    ...(typeof raw.open === 'boolean' ? { open: raw.open } : {}),
  };
  // no session has started: the line reads as full (ADR-0484 rule 3)
  return notStarted(window, kind) ? { ...window, left: 100, state: 'ok', segments: LADDER_SEGMENTS, back_words: null } : window;
}

/** The server's `usage_windows` (or `lucy_windows`) made safe to draw, or null when it is absent or
 * not in the shape this build knows: then the page keeps what it showed before the new meter. */
export function windowsOf(value: unknown): LucyWindows | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { session?: unknown; week?: unknown; lighter?: unknown; extra?: unknown };
  const week = windowOf(raw.week, 'week');
  if (!week) return null;
  const extra = raw.extra && typeof raw.extra === 'object' && typeof (raw.extra as { left?: unknown }).left === 'number'
    ? { left: whole((raw.extra as { left: number }).left, 100) } : null;
  return { session: windowOf(raw.session, 'session'), week, lighter: raw.lighter === true, extra };
}

/** The lines to draw, in order: this session (when the account has one), then this week. */
export function usageLines(windows: LucyWindows): LucyUsageLine[] {
  const lines: LucyUsageLine[] = [];
  if (windows.session) lines.push({ kind: 'session', name: 'This session', window: windows.session });
  lines.push({ kind: 'week', name: 'This week', window: windows.week });
  return lines;
}

/** The soonest reset still to come, in epoch seconds, or null. */
export function nearestReset(windows: LucyWindows | null, now = Date.now()): number | null {
  if (!windows) return null;
  const times = [windows.session, windows.week]
    .filter((window): window is LucyWindow => !!window && window.open !== false && typeof window.resets_at === 'number')
    .map((window) => window.resets_at as number)
    .filter((at) => at * 1000 > now);
  return times.length ? Math.min(...times) : null;
}

/** What to say when a line's state changes, or when a lighter Lucy starts or stops answering. */
export function newsWords(before: LucyWindows, after: LucyWindows): string[] {
  const said: string[] = [];
  const was = new Map(usageLines(before).map((line) => [line.kind, line.window.state]));
  for (const line of usageLines(after)) {
    const earlier = was.get(line.kind);
    if (earlier === undefined || earlier === line.window.state) continue;
    const state = stateWords(line.window.state);
    said.push(`${line.name}: ${state ? `${state.toLowerCase()}, ` : ''}${lineWords(line.window, line.kind)}`);
  }
  if (!before.lighter && after.lighter) said.push('A lighter Lucy is answering until this session ends');
  if (before.lighter && !after.lighter) said.push('Lucy is back to normal');
  return said;
}

/** Says a change of state once, politely, through the app's one live region. The meter and the twin
 * level meter can both be on screen; the same words within a few seconds are said only once. */
export function useLucyUsageNews(windows: LucyWindows | null) {
  const before = useRef(windows);
  useEffect(() => {
    const was = before.current;
    before.current = windows;
    if (!was || !windows) return;
    const said = newsWords(was, windows);
    if (said.length) announce(`${said.join('. ')}.`);
  }, [windows]);
}

/** The longest wait a browser timer takes. */
const LONGEST_WAIT_MS = 2 ** 31 - 1;
/** A moment past the reset, so the server has turned the window over before it is asked. */
const AFTER_RESET_MS = 1000;

/** Lucy's usage for the twin level meter: read from `/account/lucy` through the page's own request,
 * read again when the server says it moved, and once more when the nearest reset passes. Null until
 * the server sends the new figures, and for good when it never does (or no request is given). */
export function useLucyUsage(request?: Request): LucyWindows | null {
  const [windows, setWindows] = useState<LucyWindows | null>(null);
  const asked = useRef(request);
  asked.current = request;
  const read = useRef<() => void>(() => {});
  const on = !!request;
  useEffect(() => {
    if (!on) {
      setWindows(null);
      return;
    }
    let live = true;
    read.current = () => {
      void asked.current?.<{ usage_windows?: unknown }>('/account/lucy')
        .then((next) => { if (live) setWindows(windowsOf(next?.usage_windows)); })
        // what was shown stays: a read that failed is not news about the allowance
        .catch(() => {});
    };
    const again = () => read.current();
    again();
    window.addEventListener(LUCY_USAGE_EVENT, again);
    return () => {
      live = false;
      read.current = () => {};
      window.removeEventListener(LUCY_USAGE_EVENT, again);
    };
  }, [on]);
  // one timer, for the nearest reset still to come; a reset already past is never asked about twice
  const next = nearestReset(windows);
  useEffect(() => {
    if (next === null) return;
    const wait = next * 1000 - Date.now() + AFTER_RESET_MS;
    if (wait <= 0) return;
    const timer = window.setTimeout(() => read.current(), Math.min(wait, LONGEST_WAIT_MS));
    return () => window.clearTimeout(timer);
  }, [next]);
  return windows;
}
