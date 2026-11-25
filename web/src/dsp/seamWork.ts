/** Whether a transition is being prepared right now (cloud.seam_lead, ADR-0479 phase 1).
 *
 * Preparing a transition (analysis, a stretched entry, stems) is the work the listener is
 * waiting on. Background work that can wait, such as the whole-song key profiler, asks here and
 * holds off while a transition is in hand, so the two never compete for the same processor.
 * A count, because two speakers (the shell's and the Listening Room's) may prepare at once.
 */

let preparing = 0;
const waiting = new Set<() => void>();

/** Mark one transition as being prepared; call the returned function when it is done. */
export function seamWorkStarted(): () => void {
  preparing += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    preparing = Math.max(0, preparing - 1);
    if (preparing === 0) {
      for (const wake of [...waiting]) wake();
      waiting.clear();
    }
  };
}

export const seamWorkBusy = (): boolean => preparing > 0;

/** Resolves once no transition is being prepared, or after `withinMs` at the latest, so a
 * preparation that never finishes cannot hold background work for ever. */
export function seamWorkIdle(withinMs = 60_000): Promise<void> {
  if (preparing === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiting.delete(done);
      resolve();
    };
    const timer = setTimeout(done, withinMs);
    waiting.add(done);
  });
}
