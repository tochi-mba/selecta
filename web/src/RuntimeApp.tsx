import { ReactNode, Suspense, useEffect, useState } from 'react';
import { lazyPage as lazy, SlowToArrive } from './ui/staleBuild';
import { App } from './App';
import type { MixData } from './api';
import { setCopyPlace } from './copy';
import { startFeel } from './feel/root';
import { startPointerLight } from './feel/pointerLight';
import { setFlags } from './flags';
import { handOnStartupStatus } from './startupStatus';
import { BrandMark } from './ui/BrandMark';
import { cloudShellOpened } from './cloud/offlineShell';
import { prefetchLibrary } from './views/libraryPrefetch';
import { useFeelOn } from './views/feelPieces';

const CloudRoot = lazy(() => import('./cloud/CloudRoot').then((module) => ({ default: module.CloudRoot })));
const VenueStaffRoot = lazy(() => import('./venueops/VenueStaffRoot').then((module) => ({ default: module.VenueStaffRoot })));


type Mode = 'loading' | 'local' | 'cloud' | 'unavailable';
const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');
/** The same pace the app itself checks the server at once it's running. */
export const RETRY_MS = 4000;
// a build with a Cloud sign-in may turn out to be Cloud, whose Library is read differently
const cloudBuild = !!import.meta.env.VITE_WORKOS_CLIENT_ID;

export function RuntimeApp() {
  const [mode, setMode] = useState<Mode>('loading');
  const [attempt, setAttempt] = useState(0);
  const [startupMix, setStartupMix] = useState<MixData | null>(null);
  // a press of Try now that has not been answered yet (shown only with the feel on, ADR-0477)
  const [trying, setTrying] = useState(false);
  const feel = useFeelOn();

  // ADR-0477: keep <html data-feel> right from the very first screen, so the local app, Welcome,
  // every sign-in screen and both Cloud frames get the feel sheets, not only pages inside the Shell
  useEffect(() => startFeel(), []);
  useEffect(() => startPointerLight(), []);

  useEffect(() => {
    let current = true;
    // S4-0111-05: a build that can only be local opened on the Library asks for its first rows now,
    // alongside this check, rather than once the check has answered and the app has started
    if (!cloudBuild && !apiOrigin && window.location.pathname === '/library') prefetchLibrary(window.location.search);
    // The current mix is needed to lay out Make a Mix correctly. Fetch it alongside the mode
    // probe, not after first painting a false 'first mix' onboarding state and removing it.
    // The other routes still open without waiting for this optional request.
    const initialMix = !cloudBuild && window.location.pathname === '/mixes'
      ? fetch(`${apiOrigin}/api/mix`).then(async (response) => response.ok ? await response.json() as MixData : null).catch(() => null)
      : null;
    fetch(`${apiOrigin}/api/status`)
      .then(async (response) => {
        if (!response.ok) throw new Error('SelectaDJ API is unavailable.');
        const status = await response.json() as { mode?: string; flags?: Record<string, boolean> };
        if (!current) return;
        const next = status.mode === 'cloud' ? 'cloud' : 'local';
        // Words like "this PC" follow the server's place before anything is drawn (src/copy.ts).
        setCopyPlace(next === 'cloud' ? 'cloud' : 'desktop');
        if (next === 'local') {
          // The shell and Make a Mix depend on resolved feature flags for their geometry.
          // Apply the already-fetched flags before the first local React tree paints.
          setFlags(status.flags);
          handOnStartupStatus(status);
          if (initialMix) {
            const mix = await initialMix;
            if (!current) return;
            setStartupMix(mix);
          }
        }
        setTrying(false);
        // The app arrives at once. A view transition here froze the screen for seconds on a slow
        // computer, because the browser holds the old picture until the whole app has rendered.
        setMode(next);
      })
      .catch(() => {
        if (!current) return;
        setTrying(false);
        // cloud.offline_shell: a page Cloud's app-shell worker opened is Cloud, so with no
        // connection it opens from this device (CloudApp says so) instead of this message
        if (cloudBuild && cloudShellOpened()) { setCopyPlace('cloud'); setMode('cloud'); return; }
        setMode('unavailable');
      });
    return () => { current = false; };
  }, [attempt]);

  // A server that can't be reached has usually not started yet, or is restarting. Keep asking, so
  // the page picks up by itself the moment it's back, rather than waiting for a reload.
  useEffect(() => {
    if (mode !== 'unavailable') return;
    const wait = window.setTimeout(() => setAttempt((count) => count + 1), RETRY_MS);
    return () => window.clearTimeout(wait);
  }, [mode, attempt]);

  if (mode === 'loading') return <RuntimeMessage title="Starting SelectaDJ" detail="Connecting to your SelectaDJ service…" />;
  if (mode === 'unavailable') {
    return (
      <RuntimeMessage arrive title="Can’t reach SelectaDJ." detail="It may have stopped running. Start it again, and this page will pick up by itself.">
        {feel
          ? <button className="primary" aria-busy={trying || undefined} data-working={trying || undefined} onClick={() => { if (trying) return; setTrying(true); setAttempt((count) => count + 1); }}>{trying ? 'Trying…' : 'Try now'}</button>
          : <button className="primary" onClick={() => setAttempt((count) => count + 1)}>Try now</button>}
      </RuntimeMessage>
    );
  }
  if (mode === 'local') {
    if (/^\/venue\/staff\/[A-Za-z0-9_-]+$/.test(window.location.pathname)) {
      return <Suspense fallback={<RuntimeMessage title="Starting venue staff dashboard" detail="Connecting to the venue…"><SlowToArrive /></RuntimeMessage>}><VenueStaffRoot /></Suspense>;
    }
    return <App initialMix={startupMix} />;
  }

  const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID;
  if (!clientId) {
    return <RuntimeMessage title="Cloud sign-in needs configuration" detail="Set VITE_WORKOS_CLIENT_ID for this Cloud web build." />;
  }
  return <Suspense fallback={<main className="gate gate-loading" aria-busy="true"><div className="gate-wait"><BrandMark className="gate-pulse" /><p role="status">Starting SelectaDJ…</p><span className="gate-line" aria-hidden="true"><i /></span><SlowToArrive /></div></main>}><CloudRoot clientId={clientId} /></Suspense>;
}

/** `arrive`: rises in once (ADR-0477). Only the problem screen asks for it: the waiting screen follows
 * the first-paint splash, and fading it in would only flicker. */
function RuntimeMessage({ title, detail, arrive, children }: { title: string; detail: string; arrive?: boolean; children?: ReactNode }) {
  return <main className="cloud-runtime-message" data-arrive={arrive ? '' : undefined}><BrandMark className="cloud-mark" /><h1>{title}</h1><p>{detail}</p>{children}</main>;
}
