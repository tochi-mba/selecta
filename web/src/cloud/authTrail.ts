/** A short trail of sign-in trouble for this tab, so the next false "Sign in again" can be read
 * afterwards instead of guessed at.
 *
 * Each entry says when, where, and the error's name, message and (when it has them) status and
 * isTransient. Nothing else is read from the error: never a token, a header or a response body.
 * The last 20 are kept in sessionStorage under one key, inside try/catch, so a browser that
 * refuses storage loses only the trail.
 *
 * `noteSessionEnded` is called from AuthKit's own `onRefreshFailure` (CloudRoot.tsx): the one
 * moment AuthKit itself declares the session dead and removes it. Everything else that looks
 * like "no token" can heal, so only this lets a page that is open be replaced at once. */

export const AUTH_TRAIL_KEY = 'selecta.debug.auth';
const KEPT = 20;

export type AuthTrailEntry = { at: string; where: string; name: string; message: string; status?: number; isTransient?: boolean; times?: number; last?: string };

let ended = false;

/** Whether AuthKit has said, in this page load, that the session could not be renewed. */
export function sessionEnded(): boolean {
  return ended;
}

const same = (one: AuthTrailEntry, other: AuthTrailEntry) => one.where === other.where && one.name === other.name && one.message === other.message && one.status === other.status;

/** Keep the entry; the same failure again straight after the last one is counted on that entry
 * (`times`, `last`) instead of pushing the first ones out. Returns whether it was a repeat. */
function keep(entry: AuthTrailEntry): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const saved = JSON.parse(sessionStorage.getItem(AUTH_TRAIL_KEY) ?? '[]') as unknown;
    const list = Array.isArray(saved) ? (saved as AuthTrailEntry[]) : [];
    const last = list[list.length - 1];
    const repeat = last !== undefined && same(last, entry);
    const next = repeat ? [...list.slice(0, -1), { ...last, times: (last.times ?? 1) + 1, last: entry.at }] : [...list, entry];
    sessionStorage.setItem(AUTH_TRAIL_KEY, JSON.stringify(next.slice(-KEPT)));
    return repeat;
  } catch {
    // storage refused or full: the console line is still there
    return false;
  }
}

/** Record that asking AuthKit for a token (or renewing the session) failed. */
export function noteAuthProblem(where: string, error: unknown): AuthTrailEntry {
  const from = (typeof error === 'object' && error !== null ? error : {}) as { name?: unknown; message?: unknown; status?: unknown; isTransient?: unknown; constructor?: { name?: unknown } };
  const named = typeof from.name === 'string' && from.name !== 'Error' ? from.name : typeof from.constructor?.name === 'string' ? from.constructor.name : 'Error';
  const entry: AuthTrailEntry = {
    at: new Date().toISOString(),
    where,
    name: named,
    message: typeof from.message === 'string' ? from.message.slice(0, 200) : String(error).slice(0, 200),
    ...(typeof from.status === 'number' ? { status: from.status } : {}),
    ...(typeof from.isTransient === 'boolean' ? { isTransient: from.isTransient } : {}),
  };
  // a run of the same failure is said once in the console and counted in the trail
  if (!keep(entry)) console.warn(`SelectaDJ sign-in: ${where}: ${entry.name}: ${entry.message}`, { status: entry.status, isTransient: entry.isTransient });
  return entry;
}

/** AuthKit's `onRefreshFailure`: the session really is gone (the only real sign-out). */
export function noteSessionEnded(): void {
  ended = true;
  const entry: AuthTrailEntry = { at: new Date().toISOString(), where: 'authkit.onRefreshFailure', name: 'SessionEnded', message: 'AuthKit could not renew the session and removed it.' };
  console.warn('SelectaDJ sign-in: AuthKit could not renew the session and removed it.');
  keep(entry);
}

/** For tests: forget that the session ended. */
export function resetAuthTrail(): void {
  ended = false;
}
