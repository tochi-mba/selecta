import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './api';
import { configureConnection, getConnection } from './connection';
import { canHeal, classify, NOT_REACHED, NotReachedError, OfflineError, plainMessage, resilient } from './resilientRequest';

// A request that never got an answer was always called "You're offline" and flipped the whole
// tab's connection state, even when the browser was online and SelectaDJ was answering: a request
// a browser extension blocked, a cross-origin refusal, or a bug before the request was sent.

const online = (value: boolean) => vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
const blocked = (async () => { throw new TypeError('Failed to fetch'); }) as Api;

beforeEach(() => { online(true); });
afterEach(() => { vi.restoreAllMocks(); configureConnection({ reset: true, probe: async () => false }); });

describe('one request that got no answer', () => {
  it('fails by itself, in plain words, when the service is answering', async () => {
    configureConnection({ reset: true, probe: async () => true });
    const failure = await resilient(blocked, { baseMs: 1, readTimeoutMs: 0 })('/account/lucy', { method: 'PUT', body: '{}' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotReachedError);
    expect((failure as Error).message).toBe(NOT_REACHED);
    expect(plainMessage(failure)).toBe('SelectaDJ couldn’t be reached. Try again.');
    expect(plainMessage(failure)).not.toMatch(/offline/i);
    // the connection state is not flipped: nothing else on the page stops working
    expect(getConnection().status).toBe('online');
  });

  it('is not tried again and again: the same request would fail the same way', async () => {
    configureConnection({ reset: true, probe: async () => true });
    const api = vi.fn(blocked) as unknown as Api;
    await expect(resilient(api, { baseMs: 1, readTimeoutMs: 0 })('/status')).rejects.toBeInstanceOf(NotReachedError);
    expect(api).toHaveBeenCalledTimes(1);
    expect(canHeal(classify(new NotReachedError()))).toBe(false);
  });

  it('is still offline when the status check gets no answer either', async () => {
    configureConnection({ reset: true, probe: async () => false });
    const failure = await resilient(blocked, { baseMs: 1, readTimeoutMs: 0 })('/status').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OfflineError);
    expect(getConnection().status).toBe('unreachable');
  });

  it('is offline without asking when the browser says it has no network', async () => {
    const probe = vi.fn(async () => true);
    configureConnection({ reset: true, probe });
    online(false);
    const failure = await resilient(blocked, { baseMs: 1, readTimeoutMs: 0 })('/status').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OfflineError);
    expect(probe).not.toHaveBeenCalled();
  });
});
