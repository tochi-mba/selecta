import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCommandQueue, expiredText, pendingText, type KeyValueStore, type QueuedCommand, type SendResult,
} from './commandQueue';

const NOW = 1_800_000_000;

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

function setup(send: (c: QueuedCommand[]) => Promise<SendResult>, store = memStore()) {
  const clock = { now: NOW };
  const target = new EventTarget();
  let n = 0;
  const queue = createCommandQueue({
    deviceId: 'dev-1', send, store, now: () => clock.now, offsetS: () => 5,
    uuid: () => `id-${++n}`, target: target as unknown as Window, baseDelayMs: 1000, maxDelayMs: 8000,
  });
  return { queue, clock, target, store };
}

describe('commandQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('assigns uuid, per-device seq, offset and reports pending text', () => {
    const { queue } = setup(async () => ({}));
    const a = queue.enqueue('z1', 'volume', { volume: 30 });
    const b = queue.enqueue('z1', 'skip', { song_id: 's1' }, 'u1');
    expect([a.id, b.id]).toEqual(['id-1', 'id-2']);
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a).toMatchObject({ device_id: 'dev-1', device_offset_s: 5, issued_at: NOW, origin: 'staff' });
    expect(b.person_id).toBe('u1');
    expect(queue.pending()).toBe(2);
    expect(queue.statusText()).toBe('Offline: 2 changes waiting');
    expect(pendingText(1)).toBe('Offline: 1 change waiting');
    expect(pendingText(0)).toBeNull();
  });

  it('persists the queue and seq across a reload', () => {
    const store = memStore();
    const first = setup(async () => ({}), store);
    first.queue.enqueue('z1', 'steer', { energy: 1 });
    first.queue.dispose();
    const second = setup(async () => ({}), store);
    expect(second.queue.pending()).toBe(1);
    expect(second.queue.enqueue('z1', 'steer').seq).toBe(2);
  });

  it('survives a broken store', () => {
    const broken: KeyValueStore = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); } };
    const { queue } = setup(async () => ({}), broken as never);
    queue.enqueue('z1', 'play');
    expect(queue.pending()).toBe(1);
  });

  it('flushes on the online event and clears what the server answered', async () => {
    const send = vi.fn(async (cmds: QueuedCommand[]) => ({
      applied: [cmds[0].id], dropped: [{ id: cmds[1].id, reason: 'superseded' }],
    }));
    const { queue, target } = setup(send);
    queue.enqueue('z1', 'volume', { volume: 30 });
    queue.enqueue('z1', 'volume', { volume: 40 });
    target.dispatchEvent(new Event('online'));
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.pending()).toBe(0);
    expect(queue.takeDropped()).toEqual([{ id: 'id-2', reason: 'superseded' }]);
    expect(queue.takeDropped()).toEqual([]);
  });

  it('retries with exponential backoff and resends the same ids', async () => {
    let calls = 0;
    const seen: string[][] = [];
    const send = vi.fn(async (cmds: QueuedCommand[]) => {
      seen.push(cmds.map((c) => c.id));
      calls += 1;
      if (calls < 3) throw new Error('offline');
      return { applied: cmds.map((c) => c.id) };
    });
    const { queue } = setup(send);
    queue.enqueue('z1', 'steer', { energy: 1 });
    await queue.flush();
    expect(queue.attempts()).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.attempts()).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(queue.pending()).toBe(0);
    expect(seen.every((ids) => ids[0] === 'id-1')).toBe(true);
  });

  it('reconnect skips the backoff wait and concurrent flushes share one send', async () => {
    let fail = true;
    const send = vi.fn(async (_c: QueuedCommand[]): Promise<SendResult> => { if (fail) throw new Error('down'); return {}; });
    const { queue } = setup(send);
    queue.enqueue('z1', 'play');
    await queue.flush();
    fail = false;
    const a = queue.reconnected();
    const b = queue.flush();
    expect(a).toBe(b);
    await a;
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.pending()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drops staff commands older than two minutes with a plain message', async () => {
    const send = vi.fn(async (_c: QueuedCommand[]): Promise<SendResult> => ({}));
    const { queue, clock } = setup(send);
    queue.enqueue('z1', 'skip');
    clock.now += 60;
    queue.enqueue('z1', 'volume', { volume: 20 });
    clock.now += 90;
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].map((c: QueuedCommand) => c.id)).toEqual(['id-2']);
    expect(queue.takeDropped()).toEqual([{ id: 'id-1', reason: 'queued_too_long' }]);
    expect(expiredText(1)).toContain('SelectaDJ');
    expect(expiredText(3)).toContain('3 changes');
    expect(expiredText(0)).toBeNull();
  });

  it('kiosk facts never expire', () => {
    const clock = { now: NOW };
    const queue = createCommandQueue({
      deviceId: 'kiosk', origin: 'kiosk', send: async () => ({}), store: memStore(), now: () => clock.now, target: null,
    });
    queue.enqueue('z1', 'pause');
    clock.now += 3 * 3600;
    expect(queue.expire()).toEqual([]);
    expect(queue.pending()).toBe(1);
    expect(queue.list()[0].id).toMatch(/[0-9a-f-]{36}/);
  });

  it('notifies subscribers and stops listening when disposed', async () => {
    const send = vi.fn(async (_c: QueuedCommand[]): Promise<SendResult> => ({}));
    const { queue, target } = setup(send);
    const fn = vi.fn();
    const off = queue.subscribe(fn);
    queue.enqueue('z1', 'play');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    queue.dispose();
    target.dispatchEvent(new Event('online'));
    await vi.runAllTimersAsync();
    expect(send).not.toHaveBeenCalled();
  });

  it('flush with nothing queued sends nothing', async () => {
    const send = vi.fn(async (_c: QueuedCommand[]): Promise<SendResult> => ({}));
    const { queue } = setup(send);
    expect(await queue.flush()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
