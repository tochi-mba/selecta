import { PROMPT_WAIT_MS, withTimeout } from '../media/withTimeout';
import { importSnapshot, subscribeImport } from './importSession';

// Asking the browser to keep SelectaDJ's details (plan W5b). Browser storage is "best effort" by
// default: under pressure the browser may clear it, and Safari clears a site nobody opened for a
// week unless it is installed. `navigator.storage.persist()` asks for it to be kept. Browsers
// decide for themselves: Chromium grants it quietly to an installed or often-used site and says
// no otherwise, Firefox asks the person, Safari decides by its own rules. So SelectaDJ asks at two
// natural moments (the first import finishing, and a button on the This device card) and only
// ever reports what the browser actually answered. The music files are never in browser storage.

/** - `granted`: the browser said it will keep SelectaDJ's details.
 * - `not_granted`: not kept yet; asking is possible.
 * - `refused`: SelectaDJ asked just now and the browser said no.
 * - `unsupported`: this browser has no way to ask. */
export type PersistState = 'granted' | 'not_granted' | 'refused' | 'unsupported';

export type PersistStorage = { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } | undefined;

const ASKED_KEY = 'selecta.persist.asked';
const listeners = new Set<(state: PersistState) => void>();

function browserStorage(): PersistStorage {
  return typeof navigator !== 'undefined' ? (navigator.storage as PersistStorage) : undefined;
}

/** What the browser says now, without asking for anything. */
export async function readPersistState(storage: PersistStorage = browserStorage()): Promise<PersistState> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    return storage.persisted && (await storage.persisted()) ? 'granted' : 'not_granted';
  } catch {
    return 'not_granted';
  }
}

/** Asks the browser to keep SelectaDJ's details, and says what it answered. */
export async function requestPersist(storage: PersistStorage = browserStorage()): Promise<PersistState> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  let answer: PersistState;
  try {
    // a prompt left unanswered (Firefox asks) counts as not granted: the button stays to ask again
    answer = await withTimeout(storage.persist().then((kept): PersistState => (kept ? 'granted' : 'refused')), PROMPT_WAIT_MS, 'not_granted');
  } catch {
    answer = 'refused';
  }
  for (const listener of listeners) listener(answer);
  return answer;
}

/** Hears every answer to a request, so a card on screen can follow one made elsewhere. */
export function subscribePersist(listener: (state: PersistState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Marker = { get(key: string): string | null; set(key: string, value: string): void };

const localMarker: Marker = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* no storage: it may ask again next visit */ } },
};

/** Asks once, when the first import that registered songs finishes. Firefox shows a question for
 * this, so it is asked once per browser, not after every import; the card's button can always
 * ask again. Returns the unsubscribe. */
export function persistAfterFirstImport({ storage = browserStorage(), marker = localMarker }: { storage?: PersistStorage; marker?: Marker } = {}): () => void {
  let was = importSnapshot().phase;
  return subscribeImport(() => {
    const now = importSnapshot();
    const finishedNow = now.phase === 'finished' && was !== 'finished';
    was = now.phase;
    if (!finishedNow || now.registered === 0 || marker.get(ASKED_KEY)) return;
    marker.set(ASKED_KEY, '1');
    void readPersistState(storage).then((current) => {
      if (current === 'not_granted') void requestPersist(storage);
    });
  });
}
