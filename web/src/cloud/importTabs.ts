import type { ImportSnapshot } from './importSession';

// One import per workspace across every tab of this browser (flag `cloud.resilient_import`).
//
// A Web Lock per workspace makes exactly one tab the one doing the import; any other tab follows
// its progress over a BroadcastChannel and never starts a second run or deletes the first one's
// record. When the importing tab closes, the lock is freed and a follower may carry the import
// on from the journal. Where the browser has neither API, every tab acts alone, as before.

const name = (workspaceId: string) => `selecta-import-${workspaceId}`;

type Message =
  | { type: 'snapshot'; snapshot: ImportSnapshot }
  | { type: 'hello' }
  | { type: 'cancel' }
  | { type: 'released' };

export type ImportClaim = {
  /** Tell following tabs how the import stands (throttled). */
  share(snapshot: ImportSnapshot): void;
  /** A following tab pressed Cancel and the member confirmed it there. */
  onCancelAsked(listen: () => void): void;
  /** The run is over: free the lock so another tab may import. */
  release(): void;
};

type LockManagerLike = {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown): Promise<unknown>;
};

function locks(): LockManagerLike | null {
  const found = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  return found && typeof found.request === 'function' ? found : null;
}

function channel(workspaceId: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(name(workspaceId)) : null;
  } catch {
    return null;
  }
}

const SHARE_EVERY_MS = 250;

function makeClaim(workspaceId: string, unlock: () => void): ImportClaim {
  const line = channel(workspaceId);
  let latest: ImportSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = 0;
  let cancelListener: (() => void) | null = null;
  let released = false;
  const send = () => {
    timer = null;
    lastSent = Date.now();
    if (latest && line && !released) {
      try { line.postMessage({ type: 'snapshot', snapshot: latest } satisfies Message); } catch { /* a closed channel */ }
    }
  };
  if (line) {
    line.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.type === 'hello') send();
      else if (event.data?.type === 'cancel') cancelListener?.();
    };
  }
  return {
    share(snapshot) {
      latest = snapshot;
      if (!line || released) return;
      const phaseChanged = snapshot.phase !== 'running';
      if (phaseChanged || Date.now() - lastSent >= SHARE_EVERY_MS) {
        if (timer) { clearTimeout(timer); timer = null; }
        send();
      } else if (!timer) {
        timer = setTimeout(send, SHARE_EVERY_MS);
      }
    },
    onCancelAsked(listen) { cancelListener = listen; },
    release() {
      if (released) return;
      if (timer) { clearTimeout(timer); send(); }
      released = true;
      try { line?.postMessage({ type: 'released' } satisfies Message); } catch { /* closed */ }
      try { line?.close(); } catch { /* closed */ }
      unlock();
    },
  };
}

/** Become the tab that imports for this workspace, or learn (null) that another tab already is. */
export function claimImport(workspaceId: string): Promise<ImportClaim | null> {
  const manager = locks();
  if (!manager) return Promise.resolve(makeClaim(workspaceId, () => {}));
  return new Promise((resolve) => {
    let answered = false;
    manager.request(name(workspaceId), { ifAvailable: true }, (lock) => {
      answered = true;
      if (!lock) { resolve(null); return undefined; }
      // the lock is held until the run releases it
      return new Promise<void>((unlock) => resolve(makeClaim(workspaceId, unlock)));
    }).catch(() => {
      if (!answered) resolve(makeClaim(workspaceId, () => {}));
    });
  });
}

/** Follow another tab's import: its snapshots arrive in `onSnapshot`; `onFreed` runs once that
 * tab has let go (finished, or closed part way). Returns the stop function. */
export function followImport(workspaceId: string, onSnapshot: (snapshot: ImportSnapshot) => void, onFreed: () => void): () => void {
  const line = channel(workspaceId);
  const stop = new AbortController();
  let freed = false;
  const free = () => {
    if (freed || stop.signal.aborted) return;
    freed = true;
    onFreed();
  };
  if (line) {
    line.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.type === 'snapshot') onSnapshot(event.data.snapshot);
      else if (event.data?.type === 'released') free();
    };
    try { line.postMessage({ type: 'hello' } satisfies Message); } catch { /* closed */ }
  }
  const manager = locks();
  // waiting for the lock means waiting for the importing tab to let go; it is dropped at once
  if (manager) void manager.request(name(workspaceId), { signal: stop.signal }, () => undefined).then(free, () => undefined);
  return () => {
    stop.abort();
    try { line?.close(); } catch { /* closed */ }
  };
}

/** Ask the importing tab to cancel (the member confirmed it in this one). */
export function askImportCancel(workspaceId: string): void {
  const line = channel(workspaceId);
  if (!line) return;
  try { line.postMessage({ type: 'cancel' } satisfies Message); } catch { /* closed */ }
  try { line.close(); } catch { /* closed */ }
}
