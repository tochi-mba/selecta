// A browser can leave a promise pending for ever: a permission request whose prompt it swallowed,
// an install prompt dismissed in a way it does not report, an audio context it will not resume
// until a press. A button waiting on one of those said "Asking..." for good, with no way to ask
// again. `withTimeout` turns "no answer" into an ordinary answer the caller already handles.

/** How long a press waits for the browser's own prompt to be answered. */
export const PROMPT_WAIT_MS = 30_000;

/** `work`'s answer, or `fallback` once `ms` have passed with none. A rejection is passed on as it
 * came. The work itself is not stopped (a browser prompt cannot be), only no longer waited for. */
export function withTimeout<T>(work: Promise<T> | T, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(work), limit]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

/** Ask the browser for read access to a file or folder handle from a press. Resolves 'granted',
 * 'denied' or 'unanswered' (no answer within the limit: the prompt was swallowed or ignored, so the
 * press can be offered again). A handle with no permission API counts as granted, as before. */
export async function askReadAccess(handle: { requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<string> }, ms = PROMPT_WAIT_MS): Promise<string> {
  if (!handle.requestPermission) return 'granted';
  try {
    return await withTimeout(handle.requestPermission({ mode: 'read' }), ms, 'unanswered');
  } catch {
    return 'denied';
  }
}
