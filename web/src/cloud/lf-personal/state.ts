import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Api } from '../api';
import { CloudError } from '../api';
import { PersonalDevice, PersonalSnapshot, readPersonalSnapshot } from './contract';

export type PersonalReadState =
  | { phase: 'loading'; snapshot: null; message: string }
  | { phase: 'ready'; snapshot: PersonalSnapshot; message: string }
  | { phase: 'offline' | 'unavailable' | 'error'; snapshot: PersonalSnapshot | null; message: string };

const TIMEOUT_MS = 6_000;

function describeFailure(error: unknown): { phase: 'offline' | 'unavailable' | 'error'; message: string } {
  if (error instanceof CloudError && (error.status === 404 || error.status === 501)) {
    return { phase: 'unavailable', message: 'Device management has not been enabled for this workspace. Music already playing on a local engine is not affected.' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { phase: 'offline', message: 'Cloud is offline. An authorised local engine may continue playing; remote status cannot be confirmed.' };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { phase: 'error', message: 'The device status check timed out. Local playback may still be running.' };
  }
  return { phase: 'error', message: 'Device status is unavailable. No music or speaker state has been assumed.' };
}

/** No indefinite loading state. Retain previous data only with an explicit stale warning.
 * Snapshot requests are read-only metadata: no audio or local filesystem paths travel to cloud. */
export function usePersonalRead(api: Api, workspaceId: string, revision = 0) {
  const [state, setState] = useState<PersonalReadState>({ phase: 'loading', snapshot: null, message: 'Checking device availability…' });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const refresh = useCallback(() => setRefreshIndex((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), TIMEOUT_MS);
    void readPersonalSnapshot(api, workspaceId, abort.signal)
      .then((snapshot) => {
        if (active) setState({ phase: 'ready', snapshot, message: '' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const detail = describeFailure(error);
        setState((before) => ({ ...detail, snapshot: before.snapshot }));
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; abort.abort(); window.clearTimeout(timeout); };
  }, [api, workspaceId, refreshIndex, revision]);
  useEffect(() => {
    const onOnline = () => refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [refresh]);
  return { ...state, refresh };
}

const CONTROLLER_ONLY = '__controller_only__';
export function usePersonalSelection(workspaceId: string, devices: PersonalDevice[]) {
  const key = `selecta:lf10:selected-device:${workspaceId}`;
  const [chosen, setChosen] = useState(() => {
    try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
  });
  const choose = useCallback((deviceId: string) => {
    if (deviceId !== CONTROLLER_ONLY && !devices.some((device) => device.id === deviceId)) return;
    setChosen(deviceId);
    try { window.localStorage.setItem(key, deviceId); } catch { /* private browsing */ }
  }, [devices, key]);
  const selected = useMemo(() => devices.find((device) => device.id === chosen) ?? (chosen === CONTROLLER_ONLY ? null : devices.find((device) => device.role === 'engine') ?? devices[0] ?? null), [devices, chosen]);
  return { selected, controllerOnly: chosen === CONTROLLER_ONLY, choose, chooseControllerOnly: () => choose(CONTROLLER_ONLY) };
}
