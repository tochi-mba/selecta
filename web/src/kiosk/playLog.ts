// The kiosk's local log (ADR-0446 "Resync"): plays, fallback hand-offs and local actions, each
// with a device sequence number and an idempotency key, kept in localStorage until the server
// has them. Uploads are idempotent on the server, so a lost answer and a retry never count a
// play twice. If storage is unavailable the log lives in memory for this page only.

import type { LogEntry } from './player';

const KEY = 'selectadj-kiosk-log';
const SEQ = 'selectadj-kiosk-seq';
export const MAX_ENTRIES = 5000;

export type Logged = LogEntry & { device_seq: number; source?: string };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function playLog(store: StorageLike | null = defaultStore()) {
  let memory: Logged[] = [];
  let seq = 0;
  const read = (): Logged[] => {
    try {
      const raw = store?.getItem(KEY);
      return raw ? (JSON.parse(raw) as Logged[]) : memory;
    } catch {
      return memory;
    }
  };
  const write = (entries: Logged[]) => {
    memory = entries;
    try {
      store?.setItem(KEY, JSON.stringify(entries));
    } catch {
      // full or private: memory keeps them for this page
    }
  };
  try {
    seq = Number(store?.getItem(SEQ) ?? 0) || 0;
  } catch {
    seq = 0;
  }
  return {
    add(entry: LogEntry): Logged {
      seq += 1;
      try {
        store?.setItem(SEQ, String(seq));
      } catch {
        // ignore
      }
      const logged: Logged = { ...entry, device_seq: seq, source: 'schedule' };
      write([...read(), logged].slice(-MAX_ENTRIES));
      return logged;
    },
    pending: (): Logged[] => read(),
    /** Drop entries the server has (by idempotency key). */
    acknowledge(keys: Iterable<string>) {
      const done = new Set(keys);
      write(read().filter((entry) => !done.has(entry.idempotency_key)));
    },
    clear: () => write([]),
  };
}

export type PlayLog = ReturnType<typeof playLog>;
