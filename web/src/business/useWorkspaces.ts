// The workspaces this person can switch between, for the switcher and every business page
// (ADR-0453 D9 S7, flag `business.workspaces`). With the flag off this asks the server nothing and
// answers only the personal workspace, so personal pages render exactly as before.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Api } from '../cloud/api';
import { FlagId, useFlagHeard } from '../flags';
import { listWorkspaces } from './api';
import type { Workspace } from './apiTypes';
import { createWorkspaceStore, currentWorkspace } from './workspace';

// Cast through string: the id joins FlagId once the business flag file is in flags.ts's AREAS.
export const WORKSPACES_FLAG = 'business.workspaces' as string as FlagId;

export type PersonalWorkspace = { id: string; name?: string; role?: string };

export function personalEntry(personal: PersonalWorkspace): Workspace {
  return { id: personal.id, name: personal.name ?? 'Personal', kind: 'personal', role: personal.role ?? 'owner', pilot_until: null };
}

/** Puts the personal workspace first, adding it when the server's list leaves it out. */
export function withPersonal(listed: Workspace[], personal: Workspace): Workspace[] {
  const own = listed.find((w) => w.kind === 'personal') ?? personal;
  return [own, ...listed.filter((w) => w.kind !== 'personal')];
}

export function useWorkspaces({ api, userId, personal, features }: {
  api: Api;
  userId: string | null;
  personal: PersonalWorkspace;
  /** The cloud account's `features`, when the page has them: the flag must be on explicitly
   * there. Without them the site's flag registry decides, and only once the server has said. */
  features?: Record<string, boolean>;
}) {
  const heard = useFlagHeard(WORKSPACES_FLAG);
  const enabled = features ? features[WORKSPACES_FLAG] === true : heard;
  const { id, name, role } = personal;
  const own = useMemo(() => personalEntry({ id, name, role }), [id, name, role]);
  // One store per signed-in person; a new person starts from their own remembered choice.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createWorkspaceStore({ userId, workspaces: [own], online: typeof navigator === 'undefined' ? true : navigator.onLine }), [userId]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
      store.setWorkspaces([own]);
      setLoading(false);
      setError('');
      return;
    }
    let live = true;
    setLoading(true);
    listWorkspaces(api, store.getState().currentId ?? own.id)
      .then((listed) => { if (live) { store.setWorkspaces(withPersonal(listed, own)); setError(''); } })
      .catch(() => { if (live) { store.setWorkspaces([own]); setError("Couldn't load your workspaces."); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, enabled, own, store]);

  useEffect(() => {
    const follow = () => store.setDevice({ online: navigator.onLine });
    window.addEventListener('online', follow);
    window.addEventListener('offline', follow);
    return () => { window.removeEventListener('online', follow); window.removeEventListener('offline', follow); };
  }, [store]);

  return {
    enabled,
    loading,
    error,
    workspaces: state.workspaces,
    current: currentWorkspace(state) ?? own,
    /** A switcher shows only when there is somewhere else to go (S7: empty means no switcher). */
    showSwitcher: enabled && state.workspaces.length > 1,
    canSwitch: store.canSwitch,
    switchTo: store.switchTo,
    setDevice: store.setDevice,
    store,
  };
}
