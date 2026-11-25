import { flagOn } from '../flags';
import { feelNeutral } from '../feel/root';
import { showToast } from '../ui/toasts';
import { handoffsHeard, onHandoffHeard } from '../audio/handoffHeard';
import { tabBusyHere } from './accountTabs';
import { importRunningHere, importSnapshot } from './importSession';
import { installState, promptInstall, subscribeInstall, type InstallState } from './install';
import { readPersistState, requestPersist } from './persistence';

// Offering to install SelectaDJ at the moments it helps (flag `app.install`).
//
// Three moments, each offered at most once on this device, in the toast language with Install and
// Not now (Safari on iPhone and iPad gets the Share, then Add to Home Screen guidance instead of a
// button, since it has no install prompt):
// - `import`: a long import is running, so an app window keeps it out of the way of other tabs.
// - `played`: the first hand-off has been heard: a hand-over played to its end in this tab while it
//   was on screen (audio/handoffHeard.ts, T-20261125-ebda), not a guess from how long it played.
// - `room`: a room is open to host a party.
// The Workspace's own offer (StorageCard, VenuePosture) stays as it was.
//
// Never in the first minute of a first visit, never over a dialog, never while the person is
// typing, never in a hidden tab, never more than one in a visit, never once installed or where the
// browser has nothing to offer, and never again after two Not nows. The rules are pure
// (`decideOffer`, `dueMoments`) so the tests drive every branch; `watchInstallMoments` is the one
// place that reads the page and shows the offer, mounted once by the Cloud root.
//
// The words promise only what an installed app does: its own window, an icon on the dock, taskbar
// or home screen, a badge, and being less likely to be buried among tabs. It is still slowed down
// when minimised, so nothing here says otherwise.

export type InstallMoment = 'import' | 'played' | 'room';

/** What this device remembers about the offers. */
export type MomentMemory = { firstSeen: number; shown: InstallMoment[]; dismissed: InstallMoment[] };

export type OfferFacts = {
  now: number;
  flag: boolean;
  install: InstallState;
  visible: boolean;
  dialog: boolean;
  typing: boolean;
  /** An install offer was already shown in this visit. */
  offeredThisVisit: boolean;
};

export const FIRST_VISIT_QUIET_MS = 60_000;
export const MAX_DISMISSALS = 2;
/** A long import: it has run this long, or has this many files. */
export const LONG_IMPORT_MS = 90_000;
export const LONG_IMPORT_FILES = 300;
const POLL_MS = 15_000;
const TYPING_QUIET_MS = 5_000;

/** `show` now, `wait` for a better moment, or `never` for this moment. */
export function decideOffer(moment: InstallMoment, facts: OfferFacts, memory: MomentMemory): 'show' | 'wait' | 'never' {
  if (facts.install === 'installed') return 'never';
  if (memory.shown.includes(moment) || memory.dismissed.length >= MAX_DISMISSALS || facts.offeredThisVisit) return 'never';
  // the flag can come on, and the browser can offer installing later in the visit
  if (!facts.flag || facts.install === 'none') return 'wait';
  if (facts.now - memory.firstSeen < FIRST_VISIT_QUIET_MS) return 'wait';
  if (!facts.visible || facts.dialog || facts.typing) return 'wait';
  return 'show';
}

export type MomentSignals = { importHere: boolean; importMs: number; importTotal: number | null; handoffHeard: boolean; roomOpen: boolean };

/** The moments that have arrived, most pressing first. */
export function dueMoments(signals: MomentSignals): InstallMoment[] {
  const due: InstallMoment[] = [];
  if (signals.roomOpen) due.push('room');
  if (signals.importHere && (signals.importMs >= LONG_IMPORT_MS || (signals.importTotal ?? 0) >= LONG_IMPORT_FILES)) due.push('import');
  if (signals.handoffHeard) due.push('played');
  return due;
}

const WORDS: Record<InstallMoment, { prompt: string; home_screen: string }> = {
  import: {
    prompt: 'Install SelectaDJ so it keeps its own window while it checks your music.',
    home_screen: 'To give SelectaDJ its own window while it checks your music, tap Share, then Add to Home Screen.',
  },
  played: {
    prompt: 'Install SelectaDJ so your mixes have their own window and their own icon to open them from.',
    home_screen: 'To open your mixes from their own icon, tap Share, then Add to Home Screen.',
  },
  room: {
    prompt: 'Hosting? Install SelectaDJ so the room runs in its own window, where it is harder to lose among other tabs.',
    home_screen: 'Hosting? To give the room its own window, tap Share, then Add to Home Screen.',
  },
};

/** What an offer says, for the browser's way of installing. */
export function offerWords(moment: InstallMoment, how: 'prompt' | 'home_screen'): string {
  return WORDS[moment][how];
}

export const NOT_INSTALLED_WORDS = 'Not installed. You can install SelectaDJ later from the browser menu.';

const MEMORY_KEY = 'selecta.install.moments';
const MOMENTS: readonly InstallMoment[] = ['import', 'played', 'room'];

/** The remembered offers, from what was stored (anything unreadable counts as a first visit now). */
export function parseMemory(raw: string | null, now: number): MomentMemory {
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<MomentMemory> : null;
    const list = (value: unknown) => (Array.isArray(value) ? MOMENTS.filter((one) => value.includes(one)) : []);
    if (parsed && typeof parsed.firstSeen === 'number') return { firstSeen: parsed.firstSeen, shown: list(parsed.shown), dismissed: list(parsed.dismissed) };
  } catch { /* unreadable: start again */ }
  return { firstSeen: now, shown: [], dismissed: [] };
}

/** Two copies of the memory as one: everything either has shown or had dismissed, and the earlier
 * first visit. Every tab writes through this, so one tab's write can never erase another's Not now
 * (and with it the two-dismissals rule). */
export function mergeMemory(one: MomentMemory, other: MomentMemory): MomentMemory {
  const either = (pick: (memory: MomentMemory) => InstallMoment[]) => MOMENTS.filter((moment) => pick(one).includes(moment) || pick(other).includes(moment));
  return { firstSeen: Math.min(one.firstSeen, other.firstSeen), shown: either((memory) => memory.shown), dismissed: either((memory) => memory.dismissed) };
}

/** What this device remembers now. Read afresh each time, never cached for the visit, because
 * another tab may have offered or been told Not now since. */
function readMemory(now: number): MomentMemory {
  let raw: string | null = null;
  try { raw = localStorage.getItem(MEMORY_KEY); } catch { /* no storage */ }
  const memory = parseMemory(raw, now);
  if (raw === null) writeRaw(memory);
  return memory;
}

function writeRaw(memory: MomentMemory): void {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch { /* no storage: it may offer again next visit */ }
}

/** Write this tab's change merged into what is stored now, and return the result. */
function writeMemory(memory: MomentMemory): MomentMemory {
  const merged = mergeMemory(readMemory(memory.firstSeen), memory);
  writeRaw(merged);
  return merged;
}

function dialogOpen(): boolean {
  return !!document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
}

function typingNow(lastKey: number, now: number): boolean {
  if (now - lastKey < TYPING_QUIET_MS) return true;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') return true;
  return active.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes((active as HTMLInputElement).type);
}

/** Watch for the moments and offer installing at the first good one. Returns the stop function. */
export function watchInstallMoments(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
  let memory = readMemory(Date.now());
  // what had been shown when this tab started: anything shown since was offered in another tab
  // during this visit, and one offer a visit holds across tabs
  const shownAtStart = memory.shown.length;
  let offered = false;
  let lastKey = 0;
  let importSince = 0;

  const dismiss = (moment: InstallMoment) => {
    memory = writeMemory({ ...memory, dismissed: memory.dismissed.includes(moment) ? memory.dismissed : [...memory.dismissed, moment] });
  };

  const offer = (moment: InstallMoment, how: 'prompt' | 'home_screen') => {
    offered = true;
    memory = writeMemory({ ...memory, shown: [...memory.shown, moment] });
    const notNow = { label: 'Not now', run: () => dismiss(moment) };
    // closing the offer is a no, like Not now; letting it time out unread is not
    const onDismiss = () => dismiss(moment);
    if (how === 'home_screen') { showToast(offerWords(moment, how), { actions: [notNow], onDismiss }); return; }
    showToast(offerWords(moment, how), {
      onDismiss,
      actions: [{
        label: 'Install',
        primary: true,
        // asked inside the press itself, which the browser's install dialog needs
        run: () => promptInstall().then((outcome) => {
          if (outcome !== 'dismissed') return;
          dismiss(moment);
          showToast(NOT_INSTALLED_WORDS);
        }),
      }, notNow],
    });
  };

  const look = () => {
    const now = Date.now();
    const busy = tabBusyHere();
    const live = importSnapshot();
    const importHere = live.phase === 'running' && !live.elsewhere && importRunningHere();
    if (!importHere) importSince = 0;
    else if (!importSince) importSince = now;
    const due = dueMoments({ importHere, importMs: importSince ? now - importSince : 0, importTotal: live.total, handoffHeard: handoffsHeard() > 0, roomOpen: busy.room });
    // nothing pops up over the blind listening study (ADR-0477 rule 11)
    if (!due.length || offered || feelNeutral()) return;
    memory = mergeMemory(readMemory(now), memory);
    if (memory.shown.length > shownAtStart) offered = true;
    const install = installState();
    const facts: OfferFacts = {
      now, flag: flagOn('app.install'), install, visible: document.visibilityState === 'visible',
      dialog: dialogOpen(), typing: typingNow(lastKey, now), offeredThisVisit: offered,
    };
    for (const moment of due) {
      if (decideOffer(moment, facts, memory) !== 'show') continue;
      offer(moment, install === 'home_screen' ? 'home_screen' : 'prompt');
      return;
    }
  };

  // Once installed, Chromium keeps an installed app's details without asking anyone, so the
  // browser is asked again then (it said no before, or was never asked).
  const unhearInstall = subscribeInstall(() => {
    if (installState() !== 'installed') return;
    void readPersistState().then((kept) => { if (kept === 'not_granted') void requestPersist(); });
  });
  const key = () => { lastKey = Date.now(); };
  const visible = () => { if (document.visibilityState === 'visible') look(); };
  // another tab offered or was told Not now: that holds here at once, not only at the next look
  const stored = (event: StorageEvent) => {
    if (event.key !== MEMORY_KEY || event.newValue === null) return;
    memory = mergeMemory(memory, parseMemory(event.newValue, memory.firstSeen));
  };
  window.addEventListener('keydown', key, true);
  window.addEventListener('storage', stored);
  document.addEventListener('visibilitychange', visible);
  const timer = window.setInterval(look, POLL_MS);
  // the first hand-off is looked at as it is heard, not up to a poll later
  const unhearHandoff = onHandoffHeard(() => look());
  return () => {
    unhearHandoff();
    window.clearInterval(timer);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('storage', stored);
    document.removeEventListener('visibilitychange', visible);
    unhearInstall();
  };
}
