// The S4 offline command queue (ADR-0453 D10, S4 Offline row). Pure: no React, no DOM, clock and
// storage injected, so it is tested with a fake clock.
//
// Built on BZ-3's offline queue (../offline/commandQueue.ts, ADR-0446): that module already gives
// persistence, per-device seq, a uuid per command, backoff and the 2-minute expiry for staff
// commands. This wrapper adds what S4 needs on top:
// - it carries the exact ZoneCommand (in the payload) and sends each one with
//   `client.command(zone, command, id)`, the queued uuid being the idempotency key, so a resend
//   after a lost answer is harmless;
// - it reports each command dropped for age with the words "That skip was too late, so we
//   didn't send it" (word per command kind);
// - it lets an Undo pressed while offline cancel a command that has not gone yet;
// - it keeps its own storage key so a staff tablet's queue never mixes with a kiosk's.

import type { ZoneCommand } from '../client';
import { tooLateWords } from '../copy/staff';
import {
  createCommandQueue, STAFF_QUEUE_MAX_AGE_S, type CommandKind, type KeyValueStore, type QueuedCommand,
} from '../offline/commandQueue';

export { STAFF_QUEUE_MAX_AGE_S };

export type StaffSend = (zoneId: string, command: ZoneCommand, idempotencyKey: string) => Promise<unknown>;

export type Dropped = { id: string; zone_id: string; command: ZoneCommand; words: string };

export type StaffQueueOptions = {
  deviceId: string;
  send: StaffSend;
  /** Device wall clock, epoch seconds. */
  now?: () => number;
  store?: KeyValueStore;
  uuid?: () => string;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Called once per command dropped for being older than 2 minutes. */
  onDropped?: (dropped: Dropped) => void;
  /** Called after a flush delivered commands, with how many went. */
  onSent?: (count: number) => void;
};

/** The base queue names a kind for its own batch route; S4 sends one command at a time, so the
 * kind is a label for the stored entry and the exact command rides in the payload. */
export function kindLabel(command: ZoneCommand): CommandKind {
  switch (command.kind) {
    case 'skip': return 'skip';
    case 'steer': return 'steer';
    case 'pause': return 'pause';
    case 'resume': return 'play';
    case 'volume': return 'volume';
    // Not in the kiosk's kinds: undo, test and play_here are labelled by their own name.
    default: return command.kind as CommandKind;
  }
}

export function commandOf(entry: QueuedCommand): ZoneCommand {
  return (entry.payload as { command: ZoneCommand }).command;
}

const PREFIX = 'staff:';

/** A namespaced view of localStorage (memory if storage is blocked). */
export function staffStore(backing?: KeyValueStore): KeyValueStore {
  const memory = new Map<string, string>();
  return {
    get(key) {
      if (backing) return backing.get(PREFIX + key);
      try { return globalThis.localStorage?.getItem(PREFIX + key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
    },
    set(key, value) {
      if (backing) { backing.set(PREFIX + key, value); return; }
      memory.set(key, value);
      try { globalThis.localStorage?.setItem(PREFIX + key, value); } catch { /* memory only */ }
    },
  };
}

export function createStaffQueue(options: StaffQueueOptions) {
  const cancelled = new Set<string>();
  const delivered = new Set<string>();
  const base = createCommandQueue({
    deviceId: options.deviceId,
    origin: 'staff',
    maxAgeS: STAFF_QUEUE_MAX_AGE_S,
    now: options.now,
    store: staffStore(options.store),
    uuid: options.uuid,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    // S4 drives reconnects from its own offline state (useBusiness), not the window event.
    target: null,
    send: async (batch) => {
      const applied: string[] = [];
      let count = 0;
      for (const entry of batch) {
        if (!cancelled.has(entry.id) && !delivered.has(entry.id)) {
          await options.send(entry.zone_id, commandOf(entry), entry.id);
          delivered.add(entry.id);
          count += 1;
        }
        applied.push(entry.id);
      }
      if (count) options.onSent?.(count);
      return { applied };
    },
  });

  /** Drop commands older than 2 minutes, saying which, before anything is sent. */
  function sweep(): Dropped[] {
    const old = base.expire();
    const dropped = old
      .filter((entry) => !cancelled.has(entry.id))
      .map((entry) => ({ id: entry.id, zone_id: entry.zone_id, command: commandOf(entry), words: tooLateWords(commandOf(entry)) }));
    base.takeDropped();
    dropped.forEach((item) => options.onDropped?.(item));
    return dropped;
  }

  return {
    enqueue(zoneId: string, command: ZoneCommand, personId: string | null = null): QueuedCommand {
      return base.enqueue(zoneId, kindLabel(command), { command }, personId);
    },
    /** Undo while offline: a command that has not gone yet is simply not sent. */
    cancel(id: string): boolean {
      const waiting = base.list().some((entry) => entry.id === id && !cancelled.has(entry.id));
      if (waiting) cancelled.add(id);
      return waiting;
    },
    sweep,
    /** Back online: drop the stale, then send the rest now with their idempotency keys. */
    async reconnected() {
      sweep();
      return base.reconnected();
    },
    async flush() {
      sweep();
      return base.flush();
    },
    pending: () => base.list().filter((entry) => !cancelled.has(entry.id)).length,
    list: () => base.list().filter((entry) => !cancelled.has(entry.id)),
    subscribe: base.subscribe,
    dispose: base.dispose,
  };
}

export type StaffQueue = ReturnType<typeof createStaffQueue>;
