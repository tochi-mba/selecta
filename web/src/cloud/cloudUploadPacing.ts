// What the upload queue asks of the device it runs on (`cloud.move_to_cloud`): the connection
// (mobile data or Data Saver), the battery, keeping a phone's screen on, asking before the tab
// closes, and one Web Lock per workspace so only one tab of this browser uploads. Each one is a
// seam the tests replace; where the browser lacks an API the answer is the plain default.

export type ConnectionLike = {
  saveData?: boolean;
  type?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

export type BatteryLike = {
  level: number;
  charging: boolean;
  addEventListener?: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
  removeEventListener?: (type: 'levelchange' | 'chargingchange', listener: () => void) => void;
};

export type LockManagerLike = {
  request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown): Promise<unknown>;
  query?(): Promise<{ held?: { name?: string }[] }>;
};

/** The device facts the queue reads, all replaceable. */
export type Pacing = {
  connection: () => ConnectionLike | null;
  battery: () => Promise<BatteryLike | null>;
  online: () => boolean;
  locks: () => LockManagerLike | null;
  phone: () => boolean;
};

/** Below this share of battery, and not charging, uploads pause. */
export const LOW_BATTERY = 0.2;

export const browserPacing: Pacing = {
  connection: () => (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: ConnectionLike }).connection ?? null : null),
  battery: async () => {
    try {
      const get = typeof navigator !== 'undefined' ? (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery : undefined;
      return get ? await get.call(navigator) : null;
    } catch {
      return null;
    }
  },
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  locks: () => {
    const found = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
    return found && typeof found.request === 'function' ? found : null;
  },
  phone: () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
};

/** Mobile data or Data Saver: uploading asks first. */
export function metered(connection: ConnectionLike | null): boolean {
  return connection?.saveData === true || connection?.type === 'cellular';
}

/** Low and not charging: uploading pauses. */
export function batteryLow(battery: BatteryLike | null): boolean {
  return battery !== null && !battery.charging && battery.level < LOW_BATTERY;
}

/** "107 MB", "1.2 GB". */
export function sizeWords(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

/** Call `listen` when the connection, the battery or the network changes; returns the stop. */
export function watchDevice(pacing: Pacing, listen: () => void): () => void {
  const stops: (() => void)[] = [];
  const connection = pacing.connection();
  if (connection?.addEventListener) {
    connection.addEventListener('change', listen);
    stops.push(() => connection.removeEventListener?.('change', listen));
  }
  let gone = false;
  void pacing.battery().then((battery) => {
    if (gone || !battery?.addEventListener) return;
    battery.addEventListener('levelchange', listen);
    battery.addEventListener('chargingchange', listen);
    stops.push(() => { battery.removeEventListener?.('levelchange', listen); battery.removeEventListener?.('chargingchange', listen); });
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', listen);
    window.addEventListener('offline', listen);
    stops.push(() => { window.removeEventListener('online', listen); window.removeEventListener('offline', listen); });
  }
  return () => { gone = true; for (const stop of stops) stop(); };
}

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockLike = { request: (type: 'screen') => Promise<WakeLockSentinelLike> };

/** Keep a phone's screen on while uploads run, asking again when the page comes back (the
 * browser lets go of it whenever the page is hidden). Returns the stop. */
export function holdScreen(pacing: Pacing): () => void {
  if (!pacing.phone() || typeof document === 'undefined') return () => undefined;
  const lock = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock : undefined;
  if (!lock) return () => undefined;
  let held: WakeLockSentinelLike | null = null;
  let stopped = false;
  const take = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    void lock.request('screen').then((sentinel) => {
      if (stopped) void sentinel.release().catch(() => undefined);
      else held = sentinel;
    }, () => undefined);
  };
  const visible = () => { if (document.visibilityState === 'visible') take(); };
  document.addEventListener('visibilitychange', visible);
  take();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', visible);
    void held?.release().catch(() => undefined);
    held = null;
  };
}

/** While uploads run in this tab, closing or reloading it asks first. Returns the stop. */
export function guardUnload(running: () => boolean): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const ask = (event: BeforeUnloadEvent) => {
    if (!running()) return;
    event.preventDefault();
    // older browsers show a prompt only when returnValue is set
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', ask);
  return () => window.removeEventListener('beforeunload', ask);
}

/** Whether another tab of this browser holds `name` right now. Without Web Locks no tab can
 * tell, so the answer is no. */
export async function heldElsewhere(manager: LockManagerLike, name: string): Promise<boolean> {
  try {
    if (typeof manager.query === 'function') {
      const state = await manager.query();
      return (state.held ?? []).some((lock) => lock.name === name);
    }
    let held = false;
    await manager.request(name, { ifAvailable: true }, (lock) => { held = !lock; return undefined; });
    return held;
  } catch {
    return false;
  }
}
