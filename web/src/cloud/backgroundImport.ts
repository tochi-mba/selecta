import { useSyncExternalStore } from 'react';
import { countOf } from '../ui/format';
import { showToast } from '../ui/toasts';
import { importRunningHere, importSnapshot, subscribeImport, type ImportSnapshot } from './importSession';
import { isStandalone } from './install';

// An import keeps going while the person uses other tabs, and says so honestly.
//
// - While an import runs and the tab is hidden, the tab's title carries its progress ("37% checked ·
//   SelectaDJ"), and the title the page had is put back when the person returns.
// - A long import that finishes while the tab is hidden shows a system notification only where the
//   person already allowed SelectaDJ's notifications (it never asks from here), and the installed app
//   gets a badge on its icon. Otherwise the finished state simply waits in the tab.
// - The importing tab holds a Web Lock for the whole run, so the browser does not freeze it.
// - A tab the browser discarded to save memory says so once when it opens again with an import kept.
// - The import chip says, once the person is back, that checking carried on a little more slowly
//   while they were elsewhere: a hidden tab runs at a lower priority, which no page can change.

const SUFFIX = ' · SelectaDJ';
/** An import that ran this long, or this many files, is worth a notification when it finishes. */
export const LONG_IMPORT_MS = 60_000;
export const LONG_IMPORT_FILES = 300;

type Live = Pick<ImportSnapshot, 'phase' | 'total' | 'checked' | 'registered' | 'failures' | 'waiting'>;

/** The tab's title for an import while the tab is hidden, or null when the title is the page's own. */
export function hiddenTitle(live: Live): string | null {
  if (live.phase === 'finished') return `Finished checking${SUFFIX}`;
  if (live.phase === 'paused' || live.phase === 'failed') return `Import needs a look${SUFFIX}`;
  if (live.phase !== 'running') return null;
  const checked = live.checked ?? live.registered + live.failures.length;
  const lead = live.waiting?.why === 'offline' ? 'Offline, ' : '';
  if (typeof live.total === 'number' && live.total > 0) {
    // never 100% while it still runs: the last files are being sent
    const share = Math.min(99, Math.floor((checked / live.total) * 100));
    return `${lead}${share}% checked${SUFFIX}`;
  }
  return `${lead}Checking your music${SUFFIX}`;
}

/** What the notification for a finished import says. */
export function finishedWords(live: Pick<ImportSnapshot, 'folder' | 'registered' | 'failures'>): string {
  const songs = `${countOf(live.registered, 'song')} ${live.registered === 1 ? 'is' : 'are'} in your library.`;
  const unread = live.failures.length ? ` ${countOf(live.failures.length, 'file')} could not be read.` : '';
  return `Finished checking ${live.folder ?? 'your music'}. ${songs}${unread}`;
}

/** Whether an import was long enough to be worth telling someone who is elsewhere. */
export function longImport(ranMs: number, total: number | null): boolean {
  return ranMs >= LONG_IMPORT_MS || (total ?? 0) >= LONG_IMPORT_FILES;
}

export const DISCARDED_WORDS = 'Your browser closed this tab for a while to save memory. Your import is kept and carries on from where it stopped.';
export const AWAY_WORDS = 'Checking carries on while you use other tabs, a little more slowly.';

// ---- the title ---------------------------------------------------------------------------------

let ours: string | null = null;
let base: string | null = null;

/** Put `next` in the tab's title, or the page's own title back (null). Shared with the upload
 * queue (cloud.move_to_cloud). */
export function showTitle(next: string | null): void {
  if (typeof document === 'undefined') return;
  if (next === null) {
    // put the page's own title back, unless something else has set one since
    if (ours !== null && document.title === ours && base !== null) document.title = base;
    ours = null;
    base = null;
    return;
  }
  if (ours === null || document.title !== ours) base = document.title;
  if (document.title !== next) document.title = next;
  ours = next;
}

// ---- the badge and the notification ------------------------------------------------------------

type BadgeNavigator = Navigator & { setAppBadge?: () => Promise<void>; clearAppBadge?: () => Promise<void> };

function setBadge(on: boolean): void {
  if (typeof navigator === 'undefined' || !isStandalone()) return;
  const nav = navigator as BadgeNavigator;
  try {
    if (on) void nav.setAppBadge?.()?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch { /* no badge here */ }
}

/** A system notification, only where SelectaDJ's notifications are already allowed (it never
 * asks). Shared with the upload queue, under its own tag. */
export function notify(body: string, tag = 'selecta-import'): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const options = { body, tag, icon: '/icons/selecta-192.png' };
  try {
    const shown = new Notification('SelectaDJ', options);
    shown.onclick = () => { window.focus(); shown.close(); };
  } catch {
    // phones only show notifications through the service worker, where there is one
    void navigator.serviceWorker?.getRegistration?.()
      .then((registration) => registration?.showNotification('SelectaDJ', options))
      .catch(() => undefined);
  }
}

// ---- holding the tab awake ------------------------------------------------------------------------

type LockManagerLike = { request(name: string, callback: () => Promise<void>): Promise<unknown> };
const tabId = Math.random().toString(36).slice(2);
let letGo: (() => void) | null = null;

/** A page holding a Web Lock is not frozen by the browser while it is hidden. */
function holdAwake(on: boolean): void {
  if (on === (letGo !== null)) return;
  if (!on) { letGo?.(); letGo = null; return; }
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  if (!locks || typeof locks.request !== 'function') return;
  const held = new Promise<void>((resolve) => { letGo = resolve; });
  void locks.request(`selecta-import-awake-${tabId}`, () => held).catch(() => { letGo = null; });
}

// ---- "it carried on while you were away" -------------------------------------------------------

let away = false;
const awayListeners = new Set<() => void>();

function setAway(next: boolean): void {
  if (away === next) return;
  away = next;
  for (const listen of awayListeners) listen();
}

/** True once the person left the tab during the running import and came back to it. */
export function useImportWasAway(): boolean {
  return useSyncExternalStore((listen) => { awayListeners.add(listen); return () => { awayListeners.delete(listen); }; }, () => away, () => false);
}

// ---- the watcher -----------------------------------------------------------------------------------

function anyImportKept(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) if (localStorage.key(index)?.startsWith('selecta.import.')) return true;
  } catch { /* no storage: nothing to say */ }
  return false;
}

let saidDiscarded = false;

/** Start following the import for the hidden tab; returns the stop function. Mounted once, by the
 * Cloud root. */
export function watchImportInBackground(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (!saidDiscarded && (document as Document & { wasDiscarded?: boolean }).wasDiscarded && anyImportKept()) {
    saidDiscarded = true;
    showToast(DISCARDED_WORDS);
  }
  let phase = importSnapshot().phase;
  let since = phase === 'running' ? Date.now() : 0;
  /** A finished import waiting for the person to come back and look. */
  let waiting = false;
  const hidden = () => document.visibilityState === 'hidden';

  const update = () => {
    const live = importSnapshot();
    const was = phase;
    phase = live.phase;
    if (phase === 'running' && was !== 'running') { since = Date.now(); setAway(false); }
    holdAwake(phase === 'running' && importRunningHere());
    if (phase === 'running' && hidden() && !live.elsewhere) setAway(true);
    if (phase !== 'running' && was === 'running') {
      setAway(false);
      if (hidden()) {
        waiting = true;
        if (phase === 'finished' && !live.elsewhere && !live.summary?.cancelled && longImport(Date.now() - since, live.total)) {
          notify(finishedWords(live));
          setBadge(true);
        }
      }
    }
    if (hidden() && (phase === 'running' || waiting)) showTitle(hiddenTitle(live));
    else if (!hidden()) showTitle(null);
  };

  const seen = () => {
    if (hidden()) { update(); return; }
    waiting = false;
    setBadge(false);
    showTitle(null);
  };

  const unhear = subscribeImport(update);
  document.addEventListener('visibilitychange', seen);
  update();
  return () => {
    unhear();
    document.removeEventListener('visibilitychange', seen);
    holdAwake(false);
    showTitle(null);
  };
}
