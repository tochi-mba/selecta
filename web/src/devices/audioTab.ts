// ADR-0475 F, one device, many tabs: the server decides which device plays, and this decides
// which tab of that device makes the sound. Two tabs of one browser share one device id, so
// without this both could take the speaker's part and play at once (an echo; reproduced with
// two pages in one browser before this existed).
//
// - The audio tab holds a Web Lock (`navigator.locks`) for as long as it makes sound. The lock
//   frees itself when that tab closes, crashes or is discarded.
// - A tab that wants to play because the person pressed something here asks the holder to let go
//   over a BroadcastChannel; the holder stops its sound first, then releases, and only then does
//   the new tab get the lock: never two at once, even for a moment.
// - A tab that would start by itself (a reload of the speaker's tab, an ask from another device)
//   takes the lock only if nobody holds it.
// - Without Web Locks the tab plays as before (every Chromium, Firefox and Safari in use has them).

type Locks = {
  request: (name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, run: (lock: unknown) => Promise<unknown>) => Promise<unknown>;
};
type Channel = { postMessage: (data: unknown) => void; addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void; close: () => void };

/** Off unless `localStorage['selecta.debug.tabs']` is set: each step of a hand-over, for the
 * harness that proves two tabs never sound at once. */
export function tabLog(...words: unknown[]): void {
  try { if (localStorage.getItem('selecta.debug.tabs')) console.info('[tabs]', ...words); } catch { /* no storage: no log */ }
}

export type AudioTab = {
  /** Make this the audio tab. `takeOver`: the person pressed here, so another tab is asked to
   * stop first; otherwise only a free lock is taken. True when this tab may make sound. */
  claim: (takeOver: boolean) => Promise<boolean>;
  /** Let go (this tab stopped making sound). */
  release: () => void;
  holds: () => boolean;
  /** Called when another tab of this browser took the sound: stop now, synchronously. */
  onTaken: (stop: () => void) => void;
  close: () => void;
};

export function audioTab(workspaceId: string, deps: { locks?: Locks | null; channel?: Channel | null } = {}): AudioTab {
  const name = `selecta-audio:${workspaceId}`;
  const locks: Locks | null = deps.locks !== undefined ? deps.locks : (typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator as unknown as { locks: Locks }).locks : null);
  const channel: Channel | null = deps.channel !== undefined ? deps.channel : (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null);
  let letGo: (() => void) | null = null;
  let stopHere: () => void = () => undefined;

  const release = () => { const free = letGo; letGo = null; free?.(); };
  channel?.addEventListener('message', (event) => {
    tabLog('message received', JSON.stringify(event.data), 'holding:', !!letGo);
    if ((event.data as { kind?: string } | null)?.kind !== 'take' || !letGo) return;
    // stop the sound before the lock is free, so the new tab can never overlap this one
    stopHere();
    tabLog('stopped; releasing');
    release();
  });

  const hold = (ifAvailable: boolean) => new Promise<boolean>((granted) => {
    void locks!.request(name, ifAvailable ? { ifAvailable: true } : {}, (lock) => {
      if (!lock) { tabLog('lock busy'); granted(false); return Promise.resolve(); }
      tabLog('lock granted');
      return new Promise<void>((free) => { letGo = free; granted(true); });
    }).catch(() => granted(false));
  });

  return {
    claim: async (takeOver) => {
      if (!locks) return true;
      if (letGo) return true;
      if (await hold(true)) return true;
      if (!takeOver) return false;
      tabLog('asking the audio tab to let go');
      channel?.postMessage({ kind: 'take' });
      return hold(false);
    },
    release,
    holds: () => !locks || letGo !== null,
    onTaken: (stop) => { stopHere = stop; },
    close: () => { release(); channel?.close(); },
  };
}

/** One tab per browser answers what arrives for this device (asks to play from another device):
 * the first tab open holds a lock for its whole life, and the next in line takes over when it
 * closes. Without Web Locks every tab answers, as before. */
export function houseTab(workspaceId: string, locks: Locks | null = typeof navigator !== 'undefined' && 'locks' in navigator ? (navigator as unknown as { locks: Locks }).locks : null) {
  let mine = !locks;
  let letGo: (() => void) | null = null;
  if (locks) {
    void locks.request(`selecta-house:${workspaceId}`, {}, () => new Promise<void>((free) => { mine = true; letGo = free; })).catch(() => undefined);
  }
  return { holds: () => mine, close: () => { mine = false; letGo?.(); } };
}
