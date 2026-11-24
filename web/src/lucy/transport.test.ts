import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Request } from '../api';
import { lucy, setLucyTransport } from './client';
import { openStream } from './stream';

/** ADR-0476: in browser-first Cloud, Lucy's page asks the account's API under its own prefix
 * through the authenticated request, and reads events by asking, never with an EventSource. */

afterEach(() => {
  setLucyTransport(null);
  vi.useRealTimers();
});

describe('Lucy transport', () => {
  it('sends every Lucy address through the installed request under its prefix', async () => {
    const asked: [string, RequestInit | undefined][] = [];
    const request = (async (path: string, init?: RequestInit) => {
      asked.push([path, init]);
      return {};
    }) as Request;
    setLucyTransport({ request, base: '/lucy-cloud', pollMs: 500, device: () => 'device-1' });

    await lucy.status();
    await lucy.sendTurn('c 1', { client_id: 'x', text: 'hi', expected_revision: null });
    await lucy.events('c1', 7);

    expect(asked.map(([path]) => path)).toEqual([
      '/lucy-cloud/status',
      '/lucy-cloud/conversations/c%201/turns',
      '/lucy-cloud/conversations/c1/events.json?after=7',
    ]);
    expect(asked[1][1]?.method).toBe('POST');
    expect(JSON.parse(String(asked[1][1]?.body))).toEqual({ client_id: 'x', text: 'hi', expected_revision: null, device_id: 'device-1' });
  });

  it('reads events by asking at its own pace and never opens an EventSource', async () => {
    vi.useFakeTimers();
    const opened = vi.fn();
    vi.stubGlobal('EventSource', opened);
    const pages = [
      { events: [{ id: 3, v: 1, type: 'run.state', conversation: 'c1', turn: 't', run: 'r', plan: null, step: null, payload: { state: 'streaming' }, at: '' }], gap: false, cursor: 3 },
      { events: [], gap: false, cursor: 3 },
    ];
    const asked: string[] = [];
    const request = (async (path: string) => {
      asked.push(path);
      return pages.shift() ?? { events: [], gap: false, cursor: 3 };
    }) as Request;
    setLucyTransport({ request, base: '/lucy-cloud', pollMs: 500 });
    const seen: number[] = [];
    const stop = openStream('c1', 2, (events) => seen.push(...events.map((event) => event.id)), () => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    stop();

    expect(opened).not.toHaveBeenCalled();
    expect(seen).toEqual([3]);
    expect(asked).toEqual(['/lucy-cloud/conversations/c1/events.json?after=2', '/lucy-cloud/conversations/c1/events.json?after=3']);
    vi.unstubAllGlobals();
  });

  it('turns the transport client’s refusals into ApiError, keeping status and code', async () => {
    class CloudError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
    const request = (async () => { throw new CloudError('Lucy is answering a message from Phone.', 409, 'busy'); }) as Request;
    setLucyTransport({ request, base: '/lucy-cloud', pollMs: 500 });
    const refused = await lucy.status().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 409, code: 'busy', message: 'Lucy is answering a message from Phone.' });
  });
});
