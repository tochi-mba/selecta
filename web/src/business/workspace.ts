// The active workspace (ADR-0442, ADR-0453 D9 S7): which workspace this tab works in, the list it
// can switch to, and the rules that guard a switch. Personal and business never mix, so a switch
// changes library, Lucy, devices and player together; that is why a switch can be refused.
//
// - The choice is kept per signed-in person in local storage (the default for new tabs) and per
//   tab in session storage (D9: each tab keeps its own workspace). Storage may be off; every read
//   and write is guarded and the store still works in memory.
// - A device holding a zone lease is a venue's speaker: it never leaves the workspace mid-service
//   (ADR-0443). A device playing personal music asks first and switches only once confirmed.

import type { Workspace } from './apiTypes';

export type WorkspaceState = {
  /** The signed-in person, so two people on one browser keep separate choices. */
  userId: string | null;
  workspaces: Workspace[];
  currentId: string | null;
  /** This device is the speaker holding a zone's playback lease. */
  holdsZoneLease: boolean;
  /** This device is playing music from the personal workspace. */
  playingPersonal: boolean;
  online: boolean;
};

export type SwitchBlock = {
  code: 'offline' | 'unknown' | 'zone_lease' | 'playing_personal';
  reason: string;
  /** The person may go ahead after confirming (only for personal music playing here). */
  confirmable: boolean;
};

export type SwitchResult = { ok: true; workspace: Workspace } | ({ ok: false } & SwitchBlock);

export const SWITCH_REASONS: Record<SwitchBlock['code'], string> = {
  offline: "You're offline. Switch when you're back.",
  unknown: "That workspace isn't available to you.",
  zone_lease: 'This player is the speaker for a zone. Hand the zone back before you switch.',
  playing_personal: 'Your music is playing here. Keep it playing while you switch?',
};

const LOCAL_PREFIX = 'selecta.workspace.';
const TAB_KEY = 'selecta.workspace.tab';

export const storageKey = (userId: string | null) => `${LOCAL_PREFIX}${userId ?? 'anonymous'}`;

function read(storage: () => Storage, key: string): string | null {
  try { return storage().getItem(key); } catch { return null; }
}

function write(storage: () => Storage, key: string, value: string) {
  try { storage().setItem(key, value); } catch { /* storage is off; the choice lasts this visit */ }
}

/** The workspace this person last chose: this tab's choice first, then their default. */
export function rememberedWorkspace(userId: string | null): string | null {
  const tab = read(() => sessionStorage, TAB_KEY);
  if (tab) {
    try {
      const parsed = JSON.parse(tab) as { user?: string | null; id?: string };
      if (parsed.user === userId && typeof parsed.id === 'string') return parsed.id;
    } catch { /* an old or broken value: fall through to the default */ }
  }
  return read(() => localStorage, storageKey(userId));
}

export function rememberWorkspace(userId: string | null, workspaceId: string) {
  write(() => localStorage, storageKey(userId), workspaceId);
  write(() => sessionStorage, TAB_KEY, JSON.stringify({ user: userId, id: workspaceId }));
}

export const personalOf = (workspaces: Workspace[]) => workspaces.find((w) => w.kind === 'personal') ?? null;

/** The workspace to open: the remembered one if still listed, else personal, else the first. */
export function pickCurrent(workspaces: Workspace[], remembered: string | null): string | null {
  if (remembered && workspaces.some((w) => w.id === remembered)) return remembered;
  return personalOf(workspaces)?.id ?? workspaces[0]?.id ?? null;
}

export const currentWorkspace = (state: WorkspaceState) => state.workspaces.find((w) => w.id === state.currentId) ?? null;

/** Why switching to `targetId` (or anywhere, when omitted) is not allowed right now, or null. */
export function switchBlock(state: WorkspaceState, targetId?: string): SwitchBlock | null {
  if (targetId !== undefined && targetId === state.currentId) return null;
  if (targetId !== undefined && !state.workspaces.some((w) => w.id === targetId)) {
    return { code: 'unknown', reason: SWITCH_REASONS.unknown, confirmable: false };
  }
  if (!state.online) return { code: 'offline', reason: SWITCH_REASONS.offline, confirmable: false };
  if (state.holdsZoneLease) return { code: 'zone_lease', reason: SWITCH_REASONS.zone_lease, confirmable: false };
  if (state.playingPersonal && currentWorkspace(state)?.kind === 'personal') {
    return { code: 'playing_personal', reason: SWITCH_REASONS.playing_personal, confirmable: true };
  }
  return null;
}

/** The reason a switch can't happen without more from the person, or null when it can. */
export function canSwitch(state: WorkspaceState, targetId?: string): string | null {
  return switchBlock(state, targetId)?.reason ?? null;
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

export function createWorkspaceStore(init: { userId: string | null; workspaces?: Workspace[]; online?: boolean }) {
  const workspaces = init.workspaces ?? [];
  let state: WorkspaceState = {
    userId: init.userId,
    workspaces,
    currentId: pickCurrent(workspaces, rememberedWorkspace(init.userId)),
    holdsZoneLease: false,
    playingPersonal: false,
    online: init.online ?? true,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<WorkspaceState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** A fresh list from the server; keeps the current workspace when it is still listed. */
    setWorkspaces(next: Workspace[]) {
      const keep = state.currentId && next.some((w) => w.id === state.currentId) ? state.currentId : null;
      set({ workspaces: next, currentId: keep ?? pickCurrent(next, rememberedWorkspace(state.userId)) });
    },
    /** What this device is doing, from the player and the playback session. */
    setDevice(facts: Partial<Pick<WorkspaceState, 'holdsZoneLease' | 'playingPersonal' | 'online'>>) {
      set(facts);
    },
    canSwitch: (targetId?: string) => canSwitch(state, targetId),
    /** Switches and remembers the choice, unless a guard refuses. `confirmed` answers a
     * confirmable block (personal music playing here); it never overrides a zone lease. */
    switchTo(targetId: string, options: { confirmed?: boolean } = {}): SwitchResult {
      const block = switchBlock(state, targetId);
      if (block && !(block.confirmable && options.confirmed)) return { ok: false, ...block };
      const workspace = state.workspaces.find((w) => w.id === targetId)!;
      rememberWorkspace(state.userId, targetId);
      if (targetId !== state.currentId) set({ currentId: targetId });
      return { ok: true, workspace };
    },
  };
}

/** What a switcher row says: "Personal", or the organisation name with the person's role. */
export function workspaceLabel(workspace: Workspace): string {
  if (workspace.kind === 'personal') return 'Personal';
  const role = workspace.role ? workspace.role.replaceAll('_', ' ') : '';
  return role ? `${workspace.name}, ${role}` : workspace.name;
}
