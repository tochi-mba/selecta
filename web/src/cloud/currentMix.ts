import { ApiError, type Request } from '../api';

// ADR-0475 R8: the account's current mix. One recipe per account is the current mix on every
// device (`/api/local-media/current`). This browser keeps a copy of it (the recipe store's
// pointer), which is also what it shows while SelectaDJ can't be reached. A device sets the
// account's value by compare-and-set against the value it last saw, so two devices choosing at
// the same moment never overwrite each other silently: the late one is told, and takes the
// account's value. Every change reaches the other open devices on the workspace event stream.

/** The account's current mix as the server answers it. */
export type AccountCurrent = { mix_id: string | null; revision: number; updated_at: number | null; updated_by_device_name: string | null };
/** cloud.account_mixes: the account's own current mix changed (cloud_brain/mix_current.py). Not
 * a recipe: `order` is its song ids in order, and the mix itself is read from `GET /mix`. */
export type AccountTurn = { account: true; order: string; songs: number; name: string; updated_at: number; updated_by_device_name: string | null };

/** Whether a `mix.current` event is about the account's own mix rather than a recipe. */
export const isAccountTurn = (value: unknown): value is AccountTurn => !!value && typeof value === 'object' && (value as { account?: unknown }).account === true;
/** Fired on window by the Cloud event stream (CloudApp) for each `mix.current` event. */
export const CURRENT_MIX_EVENT = 'selecta:mix-current';
/** Fired on window when this device's choice lost to another device's: `detail` is the account's value. */
export const CURRENT_MIX_CONFLICT = 'selecta:mix-current-conflict';

/** Said when another device chose a different mix a moment before this one did. */
export function conflictWords(byDevice: string | null): string {
  return `${byDevice ?? 'Another device'} chose a different mix a moment ago. That one is now current; yours is saved in My Mixes.`;
}

/** This browser's playback device id, when it has registered (usePlaybackDevice keeps it). */
export function deviceId(workspaceId: string): string | null {
  try { return localStorage.getItem(`selecta.device.${workspaceId}`); } catch { return null; }
}

/** The account side of the current mix for one workspace: what was last seen, and the calls. */
export function accountCurrent(cloud: Request, workspaceId: string, pointer: { read: () => string | null; write: (mixId: string | null) => void }) {
  // what this device last saw as the account's value; undefined until it has looked once
  let seen: AccountCurrent | undefined;
  const look = async (): Promise<AccountCurrent> => {
    const now = await cloud<AccountCurrent>('/local-media/current');
    seen = now;
    return now;
  };
  /** Tell the account this device chose `mixId`. A mix made offline (not on the server yet) or a
   * connection that is down leaves this browser's choice standing until the next look. */
  const tell = async (mixId: string | null): Promise<void> => {
    try {
      if (seen === undefined) await look();
      if (seen?.mix_id === mixId) return;
      seen = await cloud<AccountCurrent>('/local-media/current', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mix_id: mixId, expected_mix_id: seen?.mix_id ?? null, device_id: deviceId(workspaceId) }),
      });
    } catch (problem) {
      if (!(problem instanceof ApiError) || problem.code !== 'current_mix_changed') return;
      // another device chose first: its mix is current here too, and this one stays saved
      const now = await look().catch(() => null);
      if (!now) return;
      pointer.write(now.mix_id);
      window.dispatchEvent(new CustomEvent(CURRENT_MIX_CONFLICT, { detail: now }));
    }
  };
  return {
    seen: () => seen,
    /** The account's value now. With none there and a mix remembered by this browser alone (the
     * old per-browser pointer), that mix is offered as the account's, once, against none. */
    sync: async (): Promise<AccountCurrent> => {
      const now = await look();
      const mine = pointer.read();
      if (now.mix_id === null && mine) {
        try {
          seen = await cloud<AccountCurrent>('/local-media/current', {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mix_id: mine, expected_mix_id: null, device_id: deviceId(workspaceId) }),
          });
          return seen;
        } catch {
          // a mix that is gone, or another device was faster: the account's value stands
          return look();
        }
      }
      return now;
    },
    /** Note a value heard on the event stream without taking it into this browser. */
    heard: (value: AccountCurrent) => { if (!seen || value.revision >= seen.revision) seen = value; },
    tell,
  };
}
