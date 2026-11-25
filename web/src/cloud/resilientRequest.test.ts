import { LoginRequiredError } from '@workos-inc/authkit-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './api';
import { CloudError } from './api';
import { configureConnection, getConnection, reportOffline, reportOk } from './connection';
import {
  answeredByApi, backoffMs, canHeal, classify, isIdempotent, OfflineError, plainMessage, resilient, TimeoutError, withRetry, worthRetrying,
} from './resilientRequest';

// The resilient request layer (plan "Nothing is lost", section 1): failures are named in a few
// plain kinds, idempotent work is tried again with capped backoff, a wait while offline does not
// spend a try, and a POST without an idempotency key is never sent twice.

const noSleep = () => Promise.resolve();

beforeEach(() => {
  configureConnection({ reset: true, probe: async () => false });
});

afterEach(() => {
  configureConnection({ reset: true, probe: async () => false });
});

describe('classify', () => {
  it('names each failure kind', () => {
    expect(classify(new OfflineError())).toBe('offline');
    expect(classify(new TimeoutError())).toBe('timeout');
    expect(classify(new TypeError('Failed to fetch'))).toBe('offline');
    expect(classify(new CloudError('x', 401))).toBe('signed_out');
    expect(classify(new CloudError('x', 408))).toBe('timeout');
    expect(classify(new CloudError('x', 429))).toBe('busy');
    expect(classify(new CloudError('x', 503))).toBe('server');
    expect(classify(new CloudError('x', 500))).toBe('server');
    expect(classify(new CloudError('x', 404))).toBe('refused');
    expect(classify(new CloudError('x', 409, 'stale_revision'))).toBe('refused');
    expect(classify(new CloudError('x', 0, 'timeout'))).toBe('timeout');
    expect(classify(new CloudError('x', 0))).toBe('offline');
    expect(classify(new DOMException('stop', 'AbortError'))).toBe('aborted');
    expect(classify(new LoginRequiredError())).toBe('signed_out');
    expect(classify({ name: 'RefreshError' })).toBe('signed_out');
    expect(classify({ isTransient: true })).toBe('offline');
    expect(classify(new Error('odd'))).toBe('refused');
  });

  it('only failures that can pass are worth another try', () => {
    expect(['offline', 'timeout', 'server', 'busy'].every((kind) => canHeal(kind as never))).toBe(true);
    expect(['signed_out', 'refused', 'aborted'].some((kind) => canHeal(kind as never))).toBe(false);
  });

  it('never shows a raw browser error', () => {
    expect(plainMessage(new TypeError('Failed to fetch'))).not.toMatch(/failed to fetch/i);
    expect(plainMessage(new TypeError('Failed to fetch'))).toMatch(/offline/i);
    expect(plainMessage(new CloudError('Request failed (404)', 404))).toBe('SelectaDJ couldn’t do that. Try again in a moment.');
    expect(plainMessage(new CloudError('That name is taken.', 409))).toBe('That name is taken.');
    expect(plainMessage(new CloudError('Request failed (503)', 503))).toMatch(/isn’t answering/);
    expect(plainMessage(new CloudError('x', 401))).toMatch(/Sign in again/);
    for (const error of [new TypeError('NetworkError when attempting to fetch resource.'), new TypeError('Load failed')]) {
      expect(plainMessage(error)).not.toMatch(/networkerror|load failed/i);
    }
  });
});

describe('backoffMs', () => {
  it('doubles from the base, capped, with jitter over the upper half', () => {
    expect(backoffMs(1, 1_000, 30_000, () => 0)).toBe(500);
    expect(backoffMs(1, 1_000, 30_000, () => 0.999)).toBeLessThanOrEqual(1_000);
    expect(backoffMs(3, 1_000, 30_000, () => 0)).toBe(2_000);
    expect(backoffMs(20, 1_000, 30_000, () => 0.999)).toBeLessThanOrEqual(30_000);
    expect(backoffMs(20, 1_000, 30_000, () => 0)).toBe(15_000);
  });
});

describe('withRetry', () => {
  it('tries a failure that can heal again, with growing waits, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    const answer = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new CloudError('busy', 503);
      return 'ok';
    }, { sleep: noSleep, random: () => 0, baseMs: 100, onWait: ({ delayMs }) => waits.push(delayMs) });
    expect(answer).toBe('ok');
    expect(calls).toBe(3);
    expect(waits).toEqual([50, 100]);
  });

  it('gives up after the attempts and throws the last failure as it came', async () => {
    const last = new CloudError('down', 502);
    let calls = 0;
    await expect(withRetry(async () => { calls += 1; throw last; }, { attempts: 3, sleep: noSleep })).rejects.toBe(last);
    expect(calls).toBe(3);
  });

  it('never repeats a refusal', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls += 1; throw new CloudError('no', 422); }, { sleep: noSleep })).rejects.toMatchObject({ status: 422 });
    expect(calls).toBe(1);
  });

  it('waits while offline without spending a try, and carries on when the connection is back', async () => {
    reportOffline();
    expect(getConnection().status).toBe('offline');
    let calls = 0;
    const running = withRetry(async () => { calls += 1; return 'sent'; }, { attempts: 1, sleep: noSleep });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(0);
    reportOk();
    await expect(running).resolves.toBe('sent');
    expect(calls).toBe(1);
  });

  it('an offline failure waits for the connection rather than failing, even with one attempt', async () => {
    let calls = 0;
    const offline: boolean[] = [];
    const running = withRetry(async () => {
      calls += 1;
      // as `resilient` does: the failure tells the store before it is thrown
      if (calls === 1) { reportOffline(); throw new OfflineError(); }
      return 'done';
    }, { attempts: 1, sleep: noSleep, onWait: (info) => offline.push(info.offline) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(1);
    expect(offline).toEqual([true]);
    reportOk();
    await expect(running).resolves.toBe('done');
  });

  it('stops at once when the signal aborts', async () => {
    const controller = new AbortController();
    reportOffline();
    const running = withRetry(async () => 'never', { signal: controller.signal });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('isIdempotent', () => {
  it('retries only what can safely be sent twice', () => {
    expect(isIdempotent()).toBe(true);
    expect(isIdempotent({ method: 'put' })).toBe(true);
    expect(isIdempotent({ method: 'DELETE' })).toBe(true);
    expect(isIdempotent({ method: 'POST' })).toBe(false);
    expect(isIdempotent({ method: 'POST', headers: { 'Idempotency-Key': 'k' } })).toBe(true);
    expect(isIdempotent({ method: 'PATCH' })).toBe(false);
  });
});

describe('resilient', () => {
  it('retries an idempotent GET that met a server error and feeds the connection store', async () => {
    let calls = 0;
    const api = (async () => {
      calls += 1;
      if (calls === 1) throw new CloudError('Request failed (500)', 500);
      return { ok: true };
    }) as Api;
    const wrapped = resilient(api, { baseMs: 1, readTimeoutMs: 0 });
    await expect(wrapped('/status')).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(getConnection().status).toBe('online');
  });

  it('stops retrying once a 503 tells the store the service is down', async () => {
    let calls = 0;
    const api = (async () => { calls += 1; throw new CloudError('Request failed (503)', 503); }) as Api;
    await expect(resilient(api, { baseMs: 1, readTimeoutMs: 0 })('/status')).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
    expect(getConnection().status).toBe('unreachable');
  });

  it('a 503 our own API wrote is the service answering: the store stays online and it is not retried', async () => {
    let calls = 0;
    const api = (async () => { calls += 1; throw new CloudError('Upgrades aren’t available right now.', 503, 'billing_not_configured'); }) as Api;
    const wrapped = resilient(api, { baseMs: 1 });
    await expect(wrapped('/billing/checkout', { method: 'POST', headers: { 'Idempotency-Key': 'one' } })).rejects.toMatchObject({ code: 'billing_not_configured' });
    expect(calls).toBe(1);
    expect(getConnection().status).toBe('online');
    for (const code of ['price_unavailable', 'webhook_not_configured', 'billing_misconfigured']) {
      expect(worthRetrying('server', new CloudError('x', 503, code))).toBe(false);
    }
  });

  it('a coded 503 that may heal is tried again, and still leaves the store online', async () => {
    let calls = 0;
    const api = (async () => {
      calls += 1;
      if (calls < 3) throw new CloudError('The payment service didn’t answer.', 503, 'billing_temporarily_unavailable');
      return 'opened';
    }) as Api;
    const wrapped = resilient(api, { baseMs: 1 });
    await expect(wrapped('/billing/checkout', { method: 'POST', headers: { 'Idempotency-Key': 'one' } })).resolves.toBe('opened');
    expect(calls).toBe(3);
    expect(getConnection().status).toBe('online');
  });

  it('only an answer with the API’s own code counts as answered by it', () => {
    expect(answeredByApi(new CloudError('x', 503, 'billing_not_configured'))).toBe(true);
    expect(answeredByApi(new CloudError('Request failed (503)', 503))).toBe(false);
    expect(answeredByApi(new CloudError('x', 0, 'offline'))).toBe(false);
    expect(answeredByApi(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('never sends a POST without an idempotency key twice', async () => {
    let calls = 0;
    const api = (async () => { calls += 1; throw new CloudError('Request failed (503)', 503); }) as Api;
    const wrapped = resilient(api, { baseMs: 1 });
    await expect(wrapped('/mixes', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  });

  it('a POST with an idempotency key may be tried again', async () => {
    let calls = 0;
    const api = (async () => {
      calls += 1;
      // a 500 is one route's bug, not the service down, so the store stays online and it retries
      if (calls === 1) throw new CloudError('Request failed (500)', 500);
      return 'made';
    }) as Api;
    const wrapped = resilient(api, { baseMs: 1 });
    await expect(wrapped('/mixes', { method: 'POST', headers: { 'Idempotency-Key': 'one' } })).resolves.toBe('made');
    expect(calls).toBe(2);
  });

  it('turns fetch\'s raw TypeError into OfflineError with plain words and says the service is unreachable', async () => {
    const api = (async () => { throw new TypeError('Failed to fetch'); }) as Api;
    const wrapped = resilient(api, { baseMs: 1, readTimeoutMs: 0 });
    const failure = await wrapped('/status').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OfflineError);
    expect((failure as Error).message).not.toMatch(/failed to fetch/i);
    expect(getConnection().status).not.toBe('online');
  });

  it('fails at once while the store already knows the service is down', async () => {
    reportOffline();
    const api = vi.fn(async () => 'never') as unknown as Api;
    await expect(resilient(api)('/status')).rejects.toBeInstanceOf(OfflineError);
    expect(api).not.toHaveBeenCalled();
  });

  it('a GET with no answer in time is a TimeoutError', async () => {
    const api = ((_path: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as Api;
    const wrapped = resilient(api, { attempts: 1, readTimeoutMs: 5 });
    await expect(wrapped('/slow')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('a write with no answer in time is a TimeoutError and a keyless POST is sent once', async () => {
    let calls = 0;
    const api = ((_path: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      calls += 1;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as Api;
    const wrapped = resilient(api, { baseMs: 1, readTimeoutMs: 0, writeTimeoutMs: 5 });
    await expect(wrapped('/mixes', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toBe(1);
  });

  it('a 401 marks the store signed out without calling the connection lost', async () => {
    const api = (async () => { throw new CloudError('Sign in', 401); }) as Api;
    await expect(resilient(api, { readTimeoutMs: 0 })('/account')).rejects.toMatchObject({ status: 401 });
    expect(getConnection()).toMatchObject({ status: 'online', signedOut: true });
  });
});
