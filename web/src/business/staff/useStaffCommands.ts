// Sending S4 commands (ADR-0453 D10, S4 matrix). Online, a command goes straight to
// `client.command` with a fresh idempotency key and its round trip is measured (over 2 s reads
// "Changes may take a few seconds"). Offline, or when the network drops mid-send, it joins the
// staff queue (commandQueue.ts) with "Will send when back online" and a count; commands older
// than 2 minutes are dropped with "That skip was too late, so we didn't send it"; the rest resend
// on reconnect with the same idempotency keys. Skip and steering are undoable for 10 seconds.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudError, idempotencyKey } from '../../cloud/api';
import { announce } from '../../ui/controls';
import { dismissToast, showToast } from '../../ui/toasts';
import type { BusinessClient, ZoneCommand } from '../client';
import { doneWords, queuedWords, STAFF_COPY } from '../copy/staff';
import { createStaffQueue, type StaffQueue } from './commandQueue';

export const UNDO_WINDOW_MS = 10_000;
export const SLOW_ROUND_TRIP_MS = 2_000;
const SWEEP_MS = 10_000;

export const undoable = (command: ZoneCommand) => command.kind === 'skip' || command.kind === 'steer';

/** A failure that means "no network", not "the server said no". */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof CloudError) return false;
  return true;
}

export function useStaffCommands({ client, offline, deviceId, personId }: {
  client: BusinessClient; offline: boolean; deviceId: string; personId: string | null;
}) {
  const [pending, setPending] = useState(0);
  const [slow, setSlow] = useState(false);
  const queueRef = useRef<StaffQueue | null>(null);
  const clientRef = useRef(client);
  clientRef.current = client;

  if (!queueRef.current) {
    queueRef.current = createStaffQueue({
      deviceId,
      send: (zone, command, key) => clientRef.current.command(zone, command, key),
      onDropped: (dropped) => showToast(dropped.words, { tone: 'problem', scope: `staff-drop:${dropped.id}` }),
      onSent: (count) => announce(STAFF_COPY.sentWhenBack(count)),
    });
  }
  const queue = queueRef.current;

  useEffect(() => {
    setPending(queue.pending());
    return queue.subscribe(() => setPending(queue.pending()));
  }, [queue]);

  // While offline, keep checking ages so a stale command is dropped (and said) on time, not only
  // when the network comes back.
  useEffect(() => {
    if (!offline) {
      if (queue.pending()) void queue.reconnected();
      return;
    }
    const timer = window.setInterval(() => queue.sweep(), SWEEP_MS);
    return () => window.clearInterval(timer);
  }, [offline, queue]);

  useEffect(() => () => queue.dispose(), [queue]);

  const offerUndo = useCallback((message: string, undo: () => Promise<unknown>) => {
    const at = Date.now();
    const id = showToast(message, {
      scope: `staff:${idempotencyKey()}`,
      undo: async () => {
        if (Date.now() - at > UNDO_WINDOW_MS) throw new Error(STAFF_COPY.tooLateToUndo);
        await undo();
      },
    });
    window.setTimeout(() => dismissToast(id), UNDO_WINDOW_MS);
  }, []);

  const enqueue = useCallback((zoneId: string, command: ZoneCommand) => {
    const entry = queue.enqueue(zoneId, command, personId);
    const message = `${doneWords(command)} ${queuedWords(queue.pending())}`;
    if (undoable(command)) offerUndo(message, async () => { queue.cancel(entry.id); });
    else showToast(message, { scope: `staff-queued:${entry.id}` });
  }, [offerUndo, personId, queue]);

  const send = useCallback(async (zoneId: string, command: ZoneCommand, options: { quiet?: boolean } = {}) => {
    if (offline) { enqueue(zoneId, command); return; }
    const started = Date.now();
    let answer: { id: string; accepted: boolean };
    try {
      answer = await client.command(zoneId, command, idempotencyKey());
    } catch (error) {
      if (isNetworkFailure(error)) { enqueue(zoneId, command); return; }
      throw error;
    }
    setSlow(Date.now() - started > SLOW_ROUND_TRIP_MS);
    if (options.quiet) return;
    if (undoable(command)) {
      offerUndo(doneWords(command), () => client.command(zoneId, { kind: 'undo', command_id: answer.id }, idempotencyKey()));
    } else {
      announce(doneWords(command));
    }
  }, [client, enqueue, offerUndo, offline]);

  return { send, pending, slow };
}
