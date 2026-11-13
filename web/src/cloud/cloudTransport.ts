import { useSyncExternalStore } from 'react';
import type { useCloudPlayer } from './useCloudPlayer';

// One Cloud player (ADR-0419, flag `cloud.single_audio_owner`).
//
// The Cloud site has two things that make sound: the Library's song player and this browser
// as the account's playback device (the speaker behind "Playing on ..."). With the flag on,
// both live in the transport dock, which CloudApp mounts above the pages, so neither stops when
// the person moves between Overview, Listen, Library and Settings (AV-0419-02). This module is
// the dock's store, kept outside React so a page can reach the dock without being its child.
//
// Exclusive focus (AV-0419-03): whichever source starts playing claims the focus, and the
// other is paused. Nothing here ever resumes anything: a song the person paused, or one paused
// because the other source started, stays paused until someone presses play. The device keeps
// its lease while paused; its next heartbeat tells the session it is paused, so every remote
// shows the truth.

export type FocusId = 'library' | 'device';
export type FocusHolder = { id: FocusId; pause: () => void };
export type SharedPlayer = ReturnType<typeof useCloudPlayer>;

export type TransportState = {
  /** Which source holds the sound now, if any. */
  focus: FocusId | null;
  /** Set when one source was paused because the other started, so the dock can say so. */
  notice: string;
};
type Shared = { workspaceId: string | null; library: SharedPlayer | null };

// Two stores, so the dock (which reads the focus) re-rendering never re-announces its player to
// itself: the Library page reads `shared`, the dock reads `state`.
const EMPTY: TransportState = { focus: null, notice: '' };
const NOBODY: Shared = { workspaceId: null, library: null };
let state: TransportState = EMPTY;
let shared: Shared = NOBODY;
let holder: FocusHolder | null = null;
const listeners = new Set<() => void>();
const playerListeners = new Set<() => void>();

function set(next: Partial<TransportState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

const NOTICES: Record<FocusId, string> = {
  library: 'The speaker on this device is paused while your library plays.',
  device: 'Your library is paused while this device plays the session.',
};

/** A source started playing: it takes the focus and whoever had it pauses (never resumes). */
export function claimFocus(next: FocusHolder) {
  const before = holder;
  holder = next;
  if (before && before.id !== next.id) {
    before.pause();
    set({ focus: next.id, notice: NOTICES[next.id] });
  } else if (state.focus !== next.id) {
    set({ focus: next.id });
  }
}

/** A source stopped or went away. The other one is NOT resumed: explicit Pause stays paused. */
export function releaseFocus(id: FocusId) {
  if (holder?.id !== id) return;
  holder = null;
  set({ focus: null });
}

export function clearNotice() {
  if (state.notice) set({ notice: '' });
}

/** The dock's Library player, offered to the Library page for this workspace only. */
export function shareLibraryPlayer(workspaceId: string | null, player: SharedPlayer | null) {
  if (shared.workspaceId === workspaceId && shared.library === player) return;
  shared = { workspaceId, library: player };
  for (const listener of playerListeners) listener();
}

/** For tests and sign-out: forget everything. */
export function resetTransport() {
  holder = null;
  state = EMPTY;
  shared = NOBODY;
  for (const listener of [...listeners, ...playerListeners]) listener();
}

export function transportState(): TransportState {
  return state;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const subscribePlayer = (listener: () => void) => {
  playerListeners.add(listener);
  return () => { playerListeners.delete(listener); };
};
const sharedNow = () => shared;

export function useTransport(): TransportState {
  return useSyncExternalStore(subscribe, transportState, transportState);
}

/** The dock's Library player when the dock is mounted for this workspace, otherwise null. */
export function useSharedLibraryPlayer(workspaceId: string): SharedPlayer | null {
  const now = useSyncExternalStore(subscribePlayer, sharedNow, sharedNow);
  return now.workspaceId === workspaceId ? now.library : null;
}
