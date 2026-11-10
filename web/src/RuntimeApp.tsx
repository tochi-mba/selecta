import { lazy, ReactNode, Suspense, useEffect, useState } from 'react';
import { App } from './App';

const CloudRoot = lazy(() => import('./cloud/CloudRoot').then((module) => ({ default: module.CloudRoot })));

type Mode = 'loading' | 'local' | 'cloud' | 'unavailable';
const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');
/** The same pace the app itself checks the server at once it's running. */
export const RETRY_MS = 4000;

export function RuntimeApp() {
  const [mode, setMode] = useState<Mode>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    fetch(`${apiOrigin}/api/status`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Selecta API is unavailable.');
        const status = await response.json() as { mode?: string };
        if (current) setMode(status.mode === 'cloud' ? 'cloud' : 'local');
      })
      .catch(() => { if (current) setMode('unavailable'); });
    return () => { current = false; };
  }, [attempt]);

  // A server that can't be reached has usually not started yet, or is restarting. Keep asking, so
  // the page picks up by itself the moment it's back, rather than waiting for a reload.
  useEffect(() => {
    if (mode !== 'unavailable') return;
    const wait = window.setTimeout(() => setAttempt((count) => count + 1), RETRY_MS);
    return () => window.clearTimeout(wait);
  }, [mode, attempt]);

  if (mode === 'loading') return <RuntimeMessage title="Starting Selecta" detail="Connecting to your Selecta service…" />;
  if (mode === 'unavailable') {
    return (
      <RuntimeMessage title="Can’t reach Selecta." detail="It may have stopped running. Start it again, and this page will pick up by itself.">
        <button className="primary" onClick={() => setAttempt((count) => count + 1)}>Try now</button>
      </RuntimeMessage>
    );
  }
  if (mode === 'local') return <App />;

  const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID;
  if (!clientId) {
    return <RuntimeMessage title="Cloud sign-in needs configuration" detail="Set VITE_WORKOS_CLIENT_ID for this Cloud web build." />;
  }
  return <Suspense fallback={<RuntimeMessage title="Starting Selecta Cloud" detail="Preparing your workspace…" />}><CloudRoot clientId={clientId} /></Suspense>;
}

function RuntimeMessage({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return <main className="cloud-runtime-message"><span className="cloud-mark">S</span><h1>{title}</h1><p>{detail}</p>{children}</main>;
}
