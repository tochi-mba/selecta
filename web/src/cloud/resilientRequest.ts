import { LoginRequiredError } from '@workos-inc/authkit-react';
import type { Api } from './api';
import { CloudError } from './api';
import { getConnection, isOnline, reportOk, reportSignedOut, reportUnreachable, waitForOnline } from './connection';

// One resilient request layer for Cloud (plan "Nothing is lost", section 1).
//
// `classify` names why a request failed in a few plain kinds; `withRetry` runs any piece of work
// again with capped exponential backoff and jitter when the failure is one that can heal, waiting
// for the connection to come back first when it is offline; `resilient` wraps the Cloud `api`
// so every call feeds the connection store and a failure is said in plain words rather than a
// raw browser error.
//
// Only idempotent work is retried by default: GET, HEAD, PUT and DELETE, or anything carrying an
// Idempotency-Key header. A POST without one is reported and thrown, never sent twice.

export type FailureKind =
  /** no network, or SelectaDJ's service did not answer (fetch failed) */
  | 'offline'
  /** it took too long */
  | 'timeout'
  /** the service answered with a 5xx */
  | 'server'
  /** 429: asked too often */
  | 'busy'
  /** 401, or the sign-in could not be renewed */
  | 'signed_out'
  /** any other refusal (a 4xx): asking again would get the same answer */
  | 'refused'
  /** the caller stopped it */
  | 'aborted';

/** Plain words for each kind, for anywhere a raw error would otherwise show. */
export const FAILURE_WORDS: Record<Exclude<FailureKind, 'refused' | 'aborted'>, string> = {
  offline: 'You’re offline. This works again when the connection is back.',
  timeout: 'SelectaDJ’s service took too long to answer. Try again in a moment.',
  server: 'SelectaDJ’s service isn’t answering right now. Try again in a moment.',
  busy: 'SelectaDJ is busy right now. Try again in a moment.',
  signed_out: 'Your sign-in has ended. Sign in again to carry on; nothing on this device is lost.',
};

/** Thrown in place of fetch's raw TypeError when there is no connection. A CloudError with
 * status 0 and code `offline`, so existing `instanceof CloudError` checks keep working. */
export class OfflineError extends CloudError {
  constructor(message: string = FAILURE_WORDS.offline) {
    super(message, 0, 'offline');
    this.name = 'OfflineError';
  }
}

/** Thrown when a request ran past its time limit. */
export class TimeoutError extends CloudError {
  constructor(message: string = FAILURE_WORDS.timeout) {
    super(message, 0, 'timeout');
    this.name = 'TimeoutError';
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/** Why a request failed, in one of a few kinds. */
export function classify(error: unknown): FailureKind {
  if (error instanceof OfflineError) return 'offline';
  if (error instanceof TimeoutError) return 'timeout';
  if (error instanceof LoginRequiredError) return 'signed_out';
  if (error instanceof CloudError) {
    if (error.status === 401) return 'signed_out';
    if (error.status === 408) return 'timeout';
    if (error.status === 429) return 'busy';
    if (error.status >= 500) return 'server';
    if (error.status === 0) return error.code === 'timeout' ? 'timeout' : 'offline';
    return 'refused';
  }
  if (isAbort(error)) return 'aborted';
  // fetch rejects with a TypeError when the request never got an answer
  if (error instanceof TypeError) return 'offline';
  // AuthKit could not renew the token because the network failed: not a sign-in problem
  if (typeof error === 'object' && error !== null && (error as { name?: string; isTransient?: boolean }).isTransient === true) return 'offline';
  if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'RefreshError') return 'signed_out';
  return 'refused';
}

/** Whether asking again could get a different answer. */
export function canHeal(kind: FailureKind): boolean {
  return kind === 'offline' || kind === 'timeout' || kind === 'server' || kind === 'busy';
}

/** Whether SelectaDJ's own API wrote this answer: it carries the API's `detail.code`. A refusal
 * like that is the service answering, whatever its status (a 503 `billing_not_configured` is one
 * route saying it is not set up, not the service being down). */
export function answeredByApi(error: unknown): boolean {
  return error instanceof CloudError && error.status > 0 && typeof error.code === 'string' && error.code.length > 0;
}

/** Coded 5xx answers that asking again cannot change: the site is not set up for it. Every other
 * coded 5xx (`billing_temporarily_unavailable`, say) may be tried again. */
const SETTLED_CODES = new Set(['billing_not_configured', 'price_unavailable', 'webhook_not_configured']);

/** Whether this failure may be tried again: one that can heal, and not a settled refusal. */
export function worthRetrying(kind: FailureKind, error: unknown): boolean {
  if (!canHeal(kind)) return false;
  return !(error instanceof CloudError && error.code !== undefined && SETTLED_CODES.has(error.code));
}

/** Whether a failure says the connection itself is in trouble (not just this request). */
function troubleOf(kind: FailureKind, error: unknown): boolean {
  if (kind === 'offline' || kind === 'timeout') return true;
  // a 502/503/504 with no answer of our own is a proxy or a dead instance: the service (or the
  // way to it) is down. One our API wrote, or a 500, is one route's trouble.
  return kind === 'server' && error instanceof CloudError && error.status >= 502 && error.status <= 504 && !answeredByApi(error);
}

/** Feed the connection store from one outcome. */
export function noteOutcome(error?: unknown): void {
  if (error === undefined) { reportOk(); return; }
  const kind = classify(error);
  if (kind === 'signed_out') { reportSignedOut(); return; }
  if (troubleOf(kind, error)) { reportUnreachable(); return; }
  // any HTTP answer (a refusal, a 500, a 429) means the service is reachable
  if (error instanceof CloudError && error.status > 0) reportOk();
}

/** Member-facing words for an error: its own message when it is a server's refusal with words,
 * the plain kind words otherwise. Never a raw "Failed to fetch". */
export function plainMessage(error: unknown): string {
  const kind = classify(error);
  if (kind === 'refused') {
    const message = error instanceof Error ? error.message : '';
    return message && !/failed to fetch|networkerror|load failed|request failed \(/i.test(message) ? message : 'SelectaDJ couldn’t do that. Try again in a moment.';
  }
  if (kind === 'aborted') return 'Stopped.';
  if (kind === 'server' && error instanceof CloudError && error.message && !/request failed \(/i.test(error.message)) return error.message;
  return FAILURE_WORDS[kind];
}

export type RetryOptions = {
  /** Most tries in all, including the first (default 4). Waiting while offline does not use one. */
  attempts?: number;
  /** The first wait between tries (default 1 s); it doubles each time, up to `maxMs`. */
  baseMs?: number;
  /** The longest wait between tries (default 30 s). */
  maxMs?: number;
  /** While offline, wait for the connection to come back instead of failing (default true). */
  waitWhileOffline?: boolean;
  /** Stops the retries and any wait. */
  signal?: AbortSignal;
  /** Which failures to try again; default `canHeal`. */
  retryOn?: (kind: FailureKind, error: unknown) => boolean;
  /** Told before each wait, so a surface can say "Trying again in 8 s". */
  onWait?: (info: { kind: FailureKind; attempt: number; delayMs: number; error: unknown; offline: boolean }) => void;
  /** For tests: the wait itself. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** For tests: jitter in [0, 1). */
  random?: () => number;
};

/** The wait before try number `attempt` (1 = the first retry): capped exponential with full jitter
 * over the upper half, so many tabs that failed together do not come back together. */
export function backoffMs(attempt: number, baseMs = 1_000, maxMs = 30_000, random: () => number = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('Stopped.', 'AbortError')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Stopped.', 'AbortError')); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** Run `work`, trying again when the failure can heal. While offline it waits for the connection
 * (unless `waitWhileOffline` is false) and that wait does not count as a try. The last failure is
 * thrown as it came, so callers can still read its status and code. */
export async function withRetry<T>(work: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const retryOn = options.retryOn ?? ((kind: FailureKind) => canHeal(kind));
  const sleep = options.sleep ?? sleepFor;
  const waitOffline = options.waitWhileOffline ?? true;
  let tried = 0;
  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Stopped.', 'AbortError');
    if (waitOffline && getConnection().status === 'offline') await waitForOnline(options.signal);
    try {
      const answer = await work();
      return answer;
    } catch (error) {
      const kind = classify(error);
      if (kind === 'aborted' || options.signal?.aborted) throw error;
      const offline = kind === 'offline' && waitOffline;
      // an offline failure while waiting is allowed does not spend a try: it waits for the network
      if (!offline) tried += 1;
      if (!retryOn(kind, error) || tried >= attempts) throw error;
      if (offline) {
        options.onWait?.({ kind, attempt: tried, delayMs: 0, error, offline: true });
        await waitForOnline(options.signal);
        continue;
      }
      const delayMs = backoffMs(tried, options.baseMs, options.maxMs, options.random);
      options.onWait?.({ kind, attempt: tried, delayMs, error, offline: false });
      await sleep(delayMs, options.signal);
    }
  }
}

/** Whether a request may safely be sent twice. */
export function isIdempotent(init?: RequestInit): boolean {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'PUT' || method === 'DELETE' || method === 'OPTIONS') return true;
  return new Headers(init?.headers).has('Idempotency-Key');
}

export type ResilientOptions = {
  /** Tries for an idempotent call while the connection is fine (default 3). */
  attempts?: number;
  /** The first wait between tries (default 600 ms). */
  baseMs?: number;
  /** A GET with no answer after this long counts as a timeout (default 20 s). 0 turns it off. */
  readTimeoutMs?: number;
};

/** Join the caller's signal with a time limit, without AbortSignal.any (not in every browser). */
function withTimeout(init: RequestInit | undefined, ms: number): { init: RequestInit; timedOut: () => boolean; done: () => void } {
  if (!ms || typeof AbortController === 'undefined') return { init: init ?? {}, timedOut: () => false, done: () => undefined };
  const controller = new AbortController();
  let expired = false;
  const outer = init?.signal ?? null;
  const follow = () => controller.abort(outer?.reason);
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener('abort', follow, { once: true });
  const timer = setTimeout(() => { expired = true; controller.abort(); }, ms);
  return {
    init: { ...init, signal: controller.signal },
    timedOut: () => expired,
    done: () => { clearTimeout(timer); outer?.removeEventListener('abort', follow); },
  };
}

/** The Cloud `api` with the request layer around it.
 *
 * - Every outcome feeds the connection store.
 * - While the store already knows the service is unreachable, or the browser is offline, a call
 *   fails at once with OfflineError, so pages can fall back to what this device knows instead of
 *   waiting. The store's own probe brings everything back.
 * - An idempotent call that fails in a way that can heal is tried again a few times quickly.
 * - A GET gets a time limit, so a connection that hangs is noticed.
 * - Raw network errors become OfflineError or TimeoutError with plain words.
 * Callers that should wait out a long outage (the import, the mix outbox) wrap their own work
 * in `withRetry`. */
export function resilient(api: Api, options: ResilientOptions = {}): Api {
  const attempts = options.attempts ?? 3;
  const baseMs = options.baseMs ?? 600;
  const readTimeoutMs = options.readTimeoutMs ?? 20_000;
  const once = async <T,>(path: string, init: RequestInit | undefined, workspaceId: string | undefined): Promise<T> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const limit = method === 'GET' ? withTimeout(init, readTimeoutMs) : null;
    try {
      const answer = await api<T>(path, limit ? limit.init : init, workspaceId);
      noteOutcome();
      return answer;
    } catch (error) {
      let thrown = error;
      if (limit?.timedOut()) thrown = new TimeoutError();
      else if (classify(error) === 'offline' && !(error instanceof CloudError)) thrown = new OfflineError();
      noteOutcome(thrown);
      throw thrown;
    } finally {
      limit?.done();
    }
  };
  return (async <T,>(path: string, init?: RequestInit, workspaceId?: string): Promise<T> => {
    // already known to be down: fail at once and let the probe say when it is back
    if (!isOnline()) throw new OfflineError();
    if (!isIdempotent(init)) return once<T>(path, init, workspaceId);
    return withRetry(() => once<T>(path, init, workspaceId), {
      attempts,
      baseMs,
      maxMs: 4_000,
      waitWhileOffline: false,
      signal: init?.signal ?? undefined,
      // once the store says it is down, stop: the page falls back and the probe takes over
      retryOn: (kind, error) => worthRetrying(kind, error) && isOnline(),
    });
  }) as Api;
}
