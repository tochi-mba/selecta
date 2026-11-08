import { useSyncExternalStore } from 'react';

/** Any page can ask for the music terms, optionally at one term. The app shell owns the one dialog,
 * so asking twice never opens two. Asking only shows words: it never touches music, mixes or the
 * server. */

export type GlossaryRequest = {
  open: boolean;
  /** The term to show first, by its id in the glossary. */
  term: string | null;
  /** Changes with every request, so asking for a different term starts the dialog afresh. */
  asked: number;
};

let current: GlossaryRequest = { open: false, term: null, asked: 0 };
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function openGlossary(term?: string | null) {
  current = { open: true, term: term ?? null, asked: current.asked + 1 };
  changed();
}

export function closeGlossary() {
  if (!current.open) return;
  current = { ...current, open: false };
  changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useGlossaryRequests(): GlossaryRequest {
  return useSyncExternalStore(subscribe, () => current);
}
