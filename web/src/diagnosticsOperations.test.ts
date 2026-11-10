import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get, post } from './api';
import { fakeBackend, Reply } from './test/backend';
import { safeDiagnostics } from './views/WorkshopPanels';

// T0244/T0248: the page can match a failed request to its outcome in Diagnostics by operation id,
// a slow status read gives up with a recoverable answer, and copied diagnostics stay redacted.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('operation correlation', () => {
  it('a refused request carries its own operation id, the one Diagnostics lists', async () => {
    fakeBackend({ 'POST /drafts': new Reply(409, { detail: 'No.', code: 'mix_changed' }) });
    const name = 'draft-1b2c3d4e-0000-4000-8000-123456789abc';
    const failure = await post('/drafts', {}, { 'x-operation-id': name }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).operation).toBe(name);
    expect((failure as ApiError).code).toBe('mix_changed');
    const copied = safeDiagnostics({ recent_operations: [{ kind: 'draft', status: 409, repeat: false, operation: name }] });
    expect(copied.recent_operations).toEqual([{ kind: 'draft', status: 409, repeat: false, operation: name }]);
  });

  it('a request without one stays without one', async () => {
    fakeBackend({ 'POST /drafts': new Reply(400, { detail: 'No.' }) });
    const failure = await post('/drafts', {}).catch((error: unknown) => error);
    expect((failure as ApiError).operation).toBe('');
  });

  it('copied diagnostics drop anything that is not a plain operation id, and every unknown field', () => {
    const copied = safeDiagnostics({
      api_version: 2,
      library: 'C:/Users/someone/Music',
      recent_operations: [
        { kind: 'draft', status: 200, repeat: false, operation: 'draft-C:/Users/someone/Private Title.flac' },
        { kind: 'C:/x', status: 200, repeat: true, title: 'Private Title' },
      ],
    });
    const text = JSON.stringify(copied);
    expect(text).not.toMatch(/Users|Private|Music/);
    expect(copied.recent_operations).toEqual([
      { kind: 'draft', status: 200, repeat: false },
      { kind: 'other', status: 200, repeat: true },
    ]);
  });
});

describe('slow status', () => {
  it('a status read that never answers gives up after 20 seconds with a recoverable timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const reading = get('/jobs').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(19_000);
    let settled = false;
    void reading.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    const failure = await reading;
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(408);
    expect((failure as ApiError).code).toBe('read_timeout');
  });

  it('a change is never given up on, so it can not look undone when it was done', async () => {
    vi.useFakeTimers();
    let answer!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined();
      return new Promise<Response>((resolve) => { answer = resolve; });
    }));
    const saving = post('/storage', { budget_bytes: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    answer(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(saving).resolves.toEqual({ ok: true });
  });
});
