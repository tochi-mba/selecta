import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openEventStream, parseFrames, StreamState, useCloudEvents } from './events';

/** A streamed answer that sends `chunks`, then stays open until `end()`, or ends at once. */
function streamed(chunks: string[], { stayOpen = false } = {}) {
  let finish: () => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (stayOpen) finish = () => controller.close();
      else controller.close();
    },
  });
  return { response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }), end: () => finish() };
}

const frame = (id: number, topic: string) => `id: ${id}\nevent: selecta\ndata: ${JSON.stringify({ id, topic, payload: {} })}\n\n`;

afterEach(() => { vi.useRealTimers(); });

describe('parseFrames', () => {
  it('splits complete frames, skips heartbeats and keeps an unfinished frame', () => {
    const { events, rest } = parseFrames(`: keep-alive\n\n${frame(4, 'job.progress')}id: 5\ndata: {"id"`);
    expect(events).toEqual([{ id: 4, data: JSON.stringify({ id: 4, topic: 'job.progress', payload: {} }) }]);
    expect(rest).toBe('id: 5\ndata: {"id"');
  });

  it('reads CRLF line ends and multi-line data', () => {
    const { events } = parseFrames('id: 9\r\ndata: a\r\ndata: b\r\n\r\n');
    expect(events).toEqual([{ id: 9, data: 'a\nb' }]);
  });
});

describe('openEventStream', () => {
  it('goes live, hands over each event once, and resumes with Last-Event-ID', async () => {
    const seen: string[] = [];
    const states: StreamState[] = [];
    const calls: Headers[] = [];
    const first = streamed([frame(3, 'entitlement.changed'), frame(3, 'entitlement.changed'), frame(4, 'job.progress')]);
    const second = streamed([frame(5, 'upload.accepted')], { stayOpen: true });
    const answers = [first.response, second.response];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers));
      return answers.shift()!;
    });
    const stream = openEventStream({ token: async () => 'tok', workspaceId: 'ws-1', fetchImpl: fetchImpl as unknown as typeof fetch, onEvent: (event) => seen.push(event.topic), onState: (state) => states.push(state) });
    await waitFor(() => expect(seen).toEqual(['entitlement.changed', 'job.progress', 'upload.accepted']));
    expect(calls[0].get('Authorization')).toBe('Bearer tok');
    expect(calls[0].get('X-Workspace-ID')).toBe('ws-1');
    expect(calls[0].has('Last-Event-ID')).toBe(false);
    expect(calls[1].get('Last-Event-ID')).toBe('4');
    expect(states).toContain('live');
    expect(states).not.toContain('polling');
    stream.close();
  });

  it('remembers the last event across a reload of the same tab and workspace', async () => {
    sessionStorage.setItem('selecta.cloud.last-event-id', JSON.stringify({ workspace: 'ws-1', id: 41 }));
    const headers: Headers[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      return streamed([], { stayOpen: true }).response;
    });
    const stream = openEventStream({ token: async () => 't', workspaceId: 'ws-1', fetchImpl: fetchImpl as unknown as typeof fetch, onEvent: () => {}, onState: () => {} });
    await waitFor(() => expect(headers).toHaveLength(1));
    expect(headers[0].get('Last-Event-ID')).toBe('41');
    stream.close();
  });

  it('falls back to polling when the stream is blocked, and keeps trying it', async () => {
    const states: StreamState[] = [];
    const fetchImpl = vi.fn(async () => { throw new TypeError('blocked'); });
    const stream = openEventStream({ token: async () => 't', workspaceId: 'ws-1', retryMs: 10, fetchImpl: fetchImpl as unknown as typeof fetch, onEvent: () => {}, onState: (state) => states.push(state) });
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(states[0]).toBe('connecting');
    expect(states).toContain('polling');
    stream.close();
  });

  it('treats an answer that is not a stream (a proxy page, a 403) as blocked', async () => {
    const states: StreamState[] = [];
    const fetchImpl = vi.fn(async () => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const stream = openEventStream({ token: async () => 't', workspaceId: 'ws-1', retryMs: 60_000, fetchImpl: fetchImpl as unknown as typeof fetch, onEvent: () => {}, onState: (state) => states.push(state) });
    await waitFor(() => expect(states).toContain('polling'));
    stream.close();
  });

  it('counts a stream that goes silent past the heartbeat as blocked', async () => {
    const states: StreamState[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))); },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const stream = openEventStream({ token: async () => 't', workspaceId: 'ws-1', silenceMs: 30, retryMs: 60_000, fetchImpl: fetchImpl as unknown as typeof fetch, onEvent: () => {}, onState: (state) => states.push(state) });
    await waitFor(() => expect(states).toContain('polling'));
    stream.close();
  });
});

describe('useCloudEvents', () => {
  it('polls the pages while the stream is down and catches up once it is back', async () => {
    let allow = false;
    const fetchImpl = vi.fn(async () => {
      if (!allow) throw new TypeError('blocked');
      return streamed([': keep-alive\n\n'], { stayOpen: true }).response;
    });
    const refresh = vi.fn(async () => {});
    const { result } = renderHook(() => useCloudEvents({ token: async () => 't', workspaceId: 'ws-1', onEvent: () => {}, refresh, pollMs: 20, fetchImpl: fetchImpl as unknown as typeof fetch }));
    await waitFor(() => expect(result.current).toBe('polling'));
    await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2));
    act(() => { allow = true; });
    await waitFor(() => expect(result.current).toBe('live'), { timeout: 5000 });
    const atLive = refresh.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Live again: no more polling beyond the one catch-up read.
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(atLive + 1);
  });

  it('opens nothing until there is a workspace', () => {
    const fetchImpl = vi.fn();
    renderHook(() => useCloudEvents({ token: async () => 't', workspaceId: null, onEvent: () => {}, refresh: () => {}, fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
