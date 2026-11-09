import { lazy, Suspense, useEffect, useState } from 'react';
import { App } from './App';

const CloudRoot = lazy(() => import('./cloud/CloudRoot').then((module) => ({ default: module.CloudRoot })));

type Mode = 'loading' | 'local' | 'cloud' | 'unavailable';
const apiOrigin = (import.meta.env.VITE_SELECTA_API_ORIGIN ?? '').replace(/\/$/, '');

export function RuntimeApp() {
  const [mode, setMode] = useState<Mode>('loading');

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
  }, []);

  if (mode === 'loading') return <RuntimeMessage title="Starting Selecta" detail="Connecting to your Selecta service…" />;
  if (mode === 'unavailable') return <RuntimeMessage title="Selecta is offline" detail="Check your connection and try again." />;
  if (mode === 'local') return <App />;

  const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID;
  if (!clientId) {
    return <RuntimeMessage title="Cloud sign-in needs configuration" detail="Set VITE_WORKOS_CLIENT_ID for this Cloud web build." />;
  }
  return <Suspense fallback={<RuntimeMessage title="Starting Selecta Cloud" detail="Preparing your workspace…" />}><CloudRoot clientId={clientId} /></Suspense>;
}

function RuntimeMessage({ title, detail }: { title: string; detail: string }) {
  return <main className="cloud-runtime-message"><span className="cloud-mark">S</span><h1>{title}</h1><p>{detail}</p></main>;
}
