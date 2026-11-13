// Commands a staff device makes while it is offline (ADR-0446 "Commands while the kiosk is
// offline"). They are persisted, carry a per-device seq and a uuid, and flush on the `online`
// event or a reconnect callback with backoff. The server dedupes by id, so a replay after a lost
// answer is harmless. Commands older than 2 minutes are dropped with a plain message.

export type CommandKind =
  | 'play' | 'pause' | 'skip' | 'volume' | 'steer' | 'stay_open_late' | 'close_now' | 'approve_request';

export type QueuedCommand = {
  id: string;
  zone_id: string;
  kind: CommandKind;
  /** Device wall clock, epoch seconds. */
  issued_at: number;
  /** Server minus device clock at the last sync. */
  device_offset_s: number;
  payload: Record<string, unknown>;
  seq: number;
  device_id: string;
  origin: 'staff' | 'kiosk';
  person_id?: string | null;
};

export type SendResult = {
  applied?: string[];
  dropped?: { id: string; reason: string }[];
  duplicates?: string[];
};

export type KeyValueStore = { get(key: string): string | null; set(key: string, value: string): void };

export type CommandQueueOptions = {
  deviceId: string;
  send: (commands: QueuedCommand[]) => Promise<SendResult>;
  store?: KeyValueStore;
  /** Device wall clock, epoch seconds. */
  now?: () => number;
  offsetS?: () => number;
  /** Kiosk-origin entries are facts and never expire. */
  origin?: 'staff' | 'kiosk';
  maxAgeS?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  uuid?: () => string;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
};

export const STAFF_QUEUE_MAX_AGE_S = 120;
const STORE_KEY = 'selectadj.business.offline.commands';

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

function defaultStore(): KeyValueStore {
  const fallback = memoryStore();
  return {
    get(k) {
      try { return globalThis.localStorage?.getItem(k) ?? fallback.get(k); } catch { return fallback.get(k); }
    },
    set(k, v) {
      fallback.set(k, v);
      try { globalThis.localStorage?.setItem(k, v); } catch { /* memory only */ }
    },
  };
}

function defaultUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, hex);
}

type Persisted = { seq: number; items: QueuedCommand[] };

export function pendingText(count: number): string | null {
  if (count <= 0) return null;
  return `Offline: ${count} ${count === 1 ? 'change' : 'changes'} waiting`;
}

export function expiredText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? 'One change was too old to send, so SelectaDJ dropped it. Please make it again.'
    : `${count} changes were too old to send, so SelectaDJ dropped them. Please make them again.`;
}

export function createCommandQueue(options: CommandQueueOptions) {
  const store = options.store ?? defaultStore();
  const now = options.now ?? (() => Date.now() / 1000);
  const offsetS = options.offsetS ?? (() => 0);
  const origin = options.origin ?? 'staff';
  const maxAgeS = options.maxAgeS ?? STAFF_QUEUE_MAX_AGE_S;
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 60_000;
  const uuid = options.uuid ?? defaultUuid;
  const target = options.target === undefined ? (typeof window !== 'undefined' ? window : null) : options.target;
  const listeners = new Set<() => void>();

  let state: Persisted = { seq: 0, items: [] };
  try {
    const raw = store.get(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed && Array.isArray(parsed.items)) state = { seq: Number(parsed.seq) || 0, items: parsed.items };
    }
  } catch { /* start empty */ }

  let inFlight: Promise<SendResult | null> | null = null;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastDropped: { id: string; reason: string }[] = [];

  const save = () => {
    try { store.set(STORE_KEY, JSON.stringify(state)); } catch { /* memory only */ }
    listeners.forEach((fn) => fn());
  };

  function expire(): QueuedCommand[] {
    if (origin === 'kiosk') return [];
    const cutoff = now() - maxAgeS;
    const old = state.items.filter((c) => c.issued_at < cutoff);
    if (old.length) {
      state.items = state.items.filter((c) => c.issued_at >= cutoff);
      lastDropped = [...lastDropped, ...old.map((c) => ({ id: c.id, reason: 'queued_too_long' }))];
      save();
    }
    return old;
  }

  function enqueue(
    zoneId: string,
    kind: CommandKind,
    payload: Record<string, unknown> = {},
    personId: string | null = null,
  ): QueuedCommand {
    state.seq += 1;
    const cmd: QueuedCommand = {
      id: uuid(),
      zone_id: zoneId,
      kind,
      issued_at: now(),
      device_offset_s: offsetS(),
      payload,
      seq: state.seq,
      device_id: options.deviceId,
      origin,
      person_id: personId,
    };
    state.items.push(cmd);
    save();
    return cmd;
  }

  function schedule(): void {
    if (timer !== null || !state.items.length) return;
    const delay = Math.min(maxDelay, baseDelay * 2 ** Math.max(0, attempts - 1));
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }

  function flush(): Promise<SendResult | null> {
    if (inFlight) return inFlight;
    expire();
    if (!state.items.length) return Promise.resolve(null);
    const batch = [...state.items];
    inFlight = options.send(batch).then(
      (result) => {
        const sent = new Set(batch.map((c) => c.id));
        state.items = state.items.filter((c) => !sent.has(c.id));
        lastDropped = [...lastDropped, ...(result.dropped ?? [])];
        attempts = 0;
        save();
        return result;
      },
      () => {
        attempts += 1;
        schedule();
        return null;
      },
    ).finally(() => { inFlight = null; });
    return inFlight;
  }

  /** Reconnect: skip any backoff wait and send now. */
  function reconnected(): Promise<SendResult | null> {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    attempts = 0;
    return flush();
  }

  const onOnline = () => { void reconnected(); };
  target?.addEventListener('online', onOnline);

  return {
    enqueue,
    flush,
    reconnected,
    expire,
    pending: () => state.items.length,
    list: (): QueuedCommand[] => [...state.items],
    statusText: () => pendingText(state.items.length),
    /** Server or age drops since the last call, then cleared. */
    takeDropped: () => { const out = lastDropped; lastDropped = []; return out; },
    attempts: () => attempts,
    subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    dispose(): void {
      target?.removeEventListener('online', onOnline);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export type CommandQueue = ReturnType<typeof createCommandQueue>;
