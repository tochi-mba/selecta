import { ComponentType, lazy, LazyExoticComponent, useEffect, useState } from 'react';
import { buildMark, newReference, reportProblem, supportHref } from '../support';

// A deploy under an open tab (docs/engineering/product-audit.md, gap 4). Route chunks are hashed
// files, and a deploy removes the old ones, so a tab opened yesterday can fail to fetch a page.
// Every lazy page goes through `lazyPage`: a failed import is tried once more, then the page is
// replaced by a calm "SelectaDJ has been updated" panel with a Reload button. Nothing reloads by
// itself, so music that is playing keeps playing until the person chooses. A per-session marker
// stops a reload loop: after one reload for an update, the panel offers support instead.

export const UPDATED_WORDS = 'SelectaDJ has been updated. Reload to carry on.';
const RELOADED = 'selecta.reloadedForUpdate';
const EVENT = 'selecta:stale-build';
let stale = false;

/** Whether an error is a page file that could not be fetched (old build gone, or offline). */
export function isChunkLoadError(error: unknown): boolean {
  const text = `${(error as { name?: string })?.name ?? ''} ${(error as { message?: string })?.message ?? error ?? ''}`;
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch module/i.test(text);
}

/** Say, once, that this tab runs an old build. */
export function markStale(): void {
  if (stale) return;
  stale = true;
  reportProblem(newReference(), 'stale_build');
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function isStale(): boolean {
  return stale;
}

/** Whether this tab already reloaded once for an update in this session. */
export function reloadedBefore(): boolean {
  try { return sessionStorage.getItem(RELOADED) !== null; } catch { return false; }
}

/** Reload for an update, remembering it for this session so a still-broken page cannot loop. */
export function reloadForUpdate(): void {
  try { sessionStorage.setItem(RELOADED, String(Date.now())); } catch { /* private mode: still reload */ }
  window.location.reload();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `React.lazy`, with one retry and the updated panel instead of a crash or a blank page. */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await load();
    } catch (first) {
      if (!isChunkLoadError(first)) throw first;
      await wait(600);
      try {
        return await load();
      } catch (second) {
        if (!isChunkLoadError(second)) throw second;
        markStale();
        return { default: StaleBuildPanel as unknown as T };
      }
    }
  });
}

/** Vite's own signal that a page's preloaded file failed: handled here, never a raw error. */
export function listenForStaleBuilds(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const preload = (event: Event) => { event.preventDefault(); markStale(); };
  window.addEventListener('vite:preloadError', preload);
  return () => window.removeEventListener('vite:preloadError', preload);
}

export function useStale(): boolean {
  const [now, setNow] = useState(stale);
  useEffect(() => {
    const on = () => setNow(true);
    window.addEventListener(EVENT, on);
    if (stale) setNow(true);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return now;
}

/** What shows where a page could not be fetched. */
export function StaleBuildPanel() {
  const again = reloadedBefore();
  return (
    <main className="page stale-build" id="main">
      <h1 className="display small">{again ? 'This page still will not open.' : 'SelectaDJ has been updated.'}</h1>
      <p className="lede" role="alert">{again
        ? 'Check your connection, then reload. If it keeps happening, contact support.'
        : 'Reload to carry on. Anything playing keeps playing until you do.'}</p>
      <div className="stale-build-actions">
        <button type="button" className="primary" onClick={reloadForUpdate}>Reload</button>
        {again && <a className="button" href={supportHref('A page will not open')}>Contact support</a>}
      </div>
    </main>
  );
}

/** The entry script's build mark in the site's current index.html, or null when unknown. */
async function liveBuild(): Promise<string | null> {
  try {
    const answer = await fetch('/index.html', { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!answer.ok) return null;
    const page = await answer.text();
    return page.match(/<script[^>]+type="module"[^>]+src="[^"]*\/assets\/([^"/]+)\.js"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const VERSION_CHECK_MS = 30 * 60_000;

/** Whether the site now serves a newer build than this tab runs. Checked every half hour and when
 * the tab comes back into view; never on the dev server, whose entry is not hashed. */
export function useNewVersion(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const running = buildMark();
    if (!running || ready) return undefined;
    let live = true;
    const check = async () => {
      const latest = await liveBuild();
      if (live && latest && latest !== running) setReady(true);
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = window.setInterval(() => void check(), VERSION_CHECK_MS);
    document.addEventListener('visibilitychange', visible);
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [ready]);
  return ready;
}

function playing(): boolean {
  return typeof navigator !== 'undefined' && navigator.mediaSession?.playbackState === 'playing';
}

/** The quiet line at the foot of the screen: "SelectaDJ has been updated" when a page could not be
 * fetched, or "A new version is ready" when nothing is playing. Never moves the page (fixed). */
export function UpdateLine() {
  const isStaleNow = useStale();
  const fresh = useNewVersion();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!fresh || isStaleNow) return undefined;
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [fresh, isStaleNow]);
  if (!isStaleNow && !(fresh && !playing())) return null;
  return (
    <div className="update-line" role="status">
      <span>{isStaleNow ? UPDATED_WORDS : 'A new version of SelectaDJ is ready.'}</span>
      <button type="button" onClick={reloadForUpdate}>Reload</button>
    </div>
  );
}
