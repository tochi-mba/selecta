import { BrowserAudioRuntime } from './BrowserAudioRuntime';

type Entry = { engine: BrowserAudioRuntime; readers: number; closing: ReturnType<typeof setTimeout> | null };
const entries = new Map<string, Entry>();

/** Shared across dock remounts, not across browser tabs. A short deferred release survives
 * React StrictMode's effect rehearsal without leaking a second AudioContext. */
export function browserEngine(workspaceId: string): BrowserAudioRuntime {
  const existing = entries.get(workspaceId);
  if (existing) return existing.engine;
  const engine = new BrowserAudioRuntime(workspaceId);
  entries.set(workspaceId, { engine, readers: 0, closing: null });
  return engine;
}
export function retainBrowserEngine(workspaceId: string, engine: BrowserAudioRuntime): () => void {
  const entry = entries.get(workspaceId);
  if (!entry || entry.engine !== engine) return () => {};
  if (entry.closing) clearTimeout(entry.closing);
  entry.closing = null;
  entry.readers += 1;
  return () => {
    entry.readers = Math.max(0, entry.readers - 1);
    if (entry.readers) return;
    entry.closing = setTimeout(() => {
      if (entry.readers) return;
      entries.delete(workspaceId);
      void engine.dispose();
    }, 0);
  };
}
