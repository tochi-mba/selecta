// Shared tablets and PINs (ADR-0453 D10, BZ-0453-14). With staff PINs on, the first action after
// 2 minutes idle (or the first action at all) asks for a PIN; the action then runs, attributed to
// the PIN holder. With PINs off, actions go straight through and are attributed to the tablet.
//
// The signal: `business.staff_pins` in org.features, read strictly with businessOn (off unless the
// server says on). Venue has no PIN field yet; when one lands, OR it in at the call site.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BusinessClient } from '../client';
import type { Role } from '../types';

export const PIN_IDLE_MS = 2 * 60 * 1000;

export type PinHolder = { name: string; role: Role | null };

export function usePinGate({ pinsOn, client, orgId, venueId }: { pinsOn: boolean; client: BusinessClient; orgId: string; venueId: string }) {
  const [holder, setHolder] = useState<PinHolder | null>(null);
  const [asking, setAsking] = useState(false);
  const pending = useRef<{ run: () => Promise<unknown> | unknown; done: (value: unknown) => void; fail: (error: unknown) => void } | null>(null);
  const idle = useRef<number | null>(null);

  const touch = useCallback(() => {
    if (!pinsOn) return;
    if (idle.current !== null) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => { idle.current = null; setHolder(null); }, PIN_IDLE_MS);
  }, [pinsOn]);

  useEffect(() => () => { if (idle.current !== null) window.clearTimeout(idle.current); }, []);

  /** Run an action, asking for a PIN first when the tablet has been idle. */
  const gate = useCallback((run: () => Promise<unknown> | unknown): Promise<unknown> => {
    if (!pinsOn || holder) {
      touch();
      return Promise.resolve().then(run);
    }
    return new Promise((done, fail) => {
      pending.current = { run, done, fail };
      setAsking(true);
    });
  }, [holder, pinsOn, touch]);

  /** True when the PIN matched; the waiting action then runs. */
  const submit = useCallback(async (pin: string): Promise<boolean> => {
    const answer = await client.checkPin(orgId, venueId, pin);
    if (!answer.ok) return false;
    setHolder({ name: answer.member_name ?? '', role: answer.role ?? null });
    setAsking(false);
    touch();
    const waiting = pending.current;
    pending.current = null;
    if (waiting) Promise.resolve().then(waiting.run).then(waiting.done, waiting.fail);
    return true;
  }, [client, orgId, touch, venueId]);

  const cancel = useCallback(() => {
    setAsking(false);
    pending.current?.done(undefined);
    pending.current = null;
  }, []);

  return { holder, asking, gate, submit, cancel };
}
