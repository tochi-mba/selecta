import { describe, expect, it, vi } from 'vitest';
import { ApiError, del, get, OFFLINE_WORDS, post, setMutationRetryDelays } from './api';

/* Selecta 2.0 T0094 (ADR-0028): every change carries an operation id, and a change that got no
 * answer at all is sent again with the same id, so the server (which keeps first answers on disk,
 * src/selecta/operation_log.py) answers a change that did land instead of doing it twice. */

type Call = { url: string; init: RequestInit };

function server(answers: (() => Response | never)[]) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next();
  }));
  return calls;
}

const id = (call: Call) => (call.init.headers as Record<string, string>)['x-operation-id'];
const nothingAnswered = () => { throw new TypeError('Failed to fetch'); };
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

describe('T0094 operation ids', () => {
  it('every change gets its own id, and one the caller chose is kept', async () => {
    const calls = server([ok({}), ok({}), ok({})]);
    await post('/drafts', {});
    await post('/drafts', {});
    await post('/requests', { song_id: 1 }, { 'x-operation-id': 'request-abc' });
    expect(id(calls[0])).toMatch(/^op-[A-Za-z0-9-]+$/);
    expect(id(calls[1])).not.toBe(id(calls[0]));
    expect(id(calls[2])).toBe('request-abc');
  });
});

describe('T0094 reconnect and resend', () => {
  it('a change that got no answer is resent with the same id until the server is back', async () => {
    setMutationRetryDelays([1, 1]);
    const calls = server([nothingAnswered, nothingAnswered, ok({ id: 7 })]);
    await expect(post('/drafts', { name: 'Friday' })).resolves.toEqual({ id: 7 });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map(id)).size).toBe(1);
    expect(calls.map((call) => call.init.body)).toEqual(Array(3).fill(JSON.stringify({ name: 'Friday' })));
  });

  it('gives up in plain words once the pauses run out', async () => {
    setMutationRetryDelays([1]);
    const calls = server([nothingAnswered, nothingAnswered]);
    await expect(post('/drafts', {})).rejects.toThrow(OFFLINE_WORDS);
    expect(calls).toHaveLength(2);
  });

  it('a refusal is an answer and is never resent', async () => {
    setMutationRetryDelays([1, 1]);
    const calls = server([() => new Response(JSON.stringify({ detail: 'No.', code: 'mix_changed' }), { status: 409 })]);
    await expect(post('/mix/songs', { song_id: 1 })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it('reads and deletes are not resent by this', async () => {
    setMutationRetryDelays([1, 1]);
    const reads = server([nothingAnswered]);
    await expect(get('/status')).rejects.toThrow(OFFLINE_WORDS);
    expect(reads).toHaveLength(1);
    const deletes = server([nothingAnswered]);
    await expect(del('/requests/1')).rejects.toThrow(OFFLINE_WORDS);
    expect(deletes).toHaveLength(1);
  });
});
