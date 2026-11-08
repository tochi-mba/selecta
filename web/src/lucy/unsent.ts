import { useCallback, useState } from 'react';

/** What's been typed to Lucy and not sent yet, kept per conversation in this browser so a reload or a
 * wander elsewhere doesn't lose it. Each conversation has its own: one never shows up in another. */

export const unsentKey = (conversation: string | null) => `selecta.lucy.unsent.${conversation ?? 'new'}`;

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, text: string) {
  try {
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    /* it stays on screen; it just won't survive a reload */
  }
}

/** Forget what was stored, but only if it's still exactly what was sent. */
export function forgetSent(conversation: string | null, sent: string) {
  const key = unsentKey(conversation);
  if (read(key).trim() === sent.trim()) write(key, '');
}

export function useUnsent(conversation: string | null) {
  const key = unsentKey(conversation);
  const [held, setHeld] = useState(() => ({ key, text: read(key) }));
  // a different conversation shows its own words straight away, never the last one's for a moment
  const current = held.key === key ? held : { key, text: read(key) };
  if (held.key !== key) setHeld(current);
  const change = useCallback((text: string) => {
    setHeld({ key, text });
    write(key, text);
  }, [key]);
  /** Empty the box while a message is on its way, keeping the stored copy until it's accepted. */
  const hold = useCallback(() => setHeld({ key, text: '' }), [key]);
  return { text: current.text, change, hold };
}
