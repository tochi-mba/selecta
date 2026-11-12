// The browser-test harness for the cloud playback and Rooms panels. It's built only with
// SELECTA_CLOUD_E2E=1 (see rooms.vite.ts) and served by tests/cloud_e2e_server.py, which signs in
// test people by bearer token. It mounts the same components the Cloud app does, against the
// real cloud API, without AuthKit. `?as=alice` picks the person.

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DevicesPanel } from '../devices/DevicesPanel';
import { PlayingBar } from '../devices/PlayingBar';
import { RoomPanel } from '../rooms/RoomPanel';

class HarnessError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

const params = new URLSearchParams(location.search);
const token = params.get('as') ?? 'alice';
const source = async (index: number) => (index < 6 ? `/e2e/audio/${index}.wav` : null);
const songName = (index: number) => `Test song ${index + 1}`;

function Harness() {
  const [account, setAccount] = useState<{ workspace: { id: string }; features: Record<string, boolean>; feature_locks: Record<string, string> } | null>(null);
  const api = useCallback(async <T,>(path: string, init: RequestInit = {}, workspaceId?: string): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (workspaceId) headers.set('X-Workspace-ID', workspaceId);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`/api${path}`, { ...init, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.detail;
      const code = detail && typeof detail === 'object' ? detail.code : payload?.code;
      const message = detail && typeof detail === 'object' ? detail.message : typeof detail === 'string' ? detail : 'Request failed';
      throw new HarnessError(message ?? 'Request failed', response.status, code);
    }
    return payload as T;
  }, []);
  useEffect(() => { void api<typeof account>('/account').then(setAccount); }, [api]);
  if (!account) return <p>Signing in...</p>;
  const ws = account.workspace.id;
  return (
    <main style={{ display: 'grid', gap: 16, padding: 16, maxWidth: 900 }}>
      <PlayingBar api={api} workspaceId={ws} source={source} songName={songName} />
      {params.get('rooms') !== '0' && (
        <RoomPanel api={api} workspaceId={ws} locked={account.feature_locks.rooms} votesOn={account.features['rooms.votes'] !== false} displayOn={account.features['rooms.display'] !== false} />
      )}
      <DevicesPanel api={api} workspaceId={ws} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
