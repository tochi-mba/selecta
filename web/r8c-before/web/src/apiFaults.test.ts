// SF-0242-05: fault injection for the words a failed request shows. Each fault is made at the
// fetch boundary, and each message must name what went wrong and a safe next step, never a
// developer's words like "TypeError", "Internal Server Error" or a bare status code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, OFFLINE_WORDS, SERVER_FAILED_WORDS, TURNED_OFF_WORDS, get, post, problemKind } from './api';

const NEXT_STEP = /try again|refresh/i;
const DEVELOPER = /TypeError|Internal Server Error|Failed to fetch|undefined|null|\b[45]\d\d\b/;

function answer(status: number, body?: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body === undefined ? 'not json' : JSON.stringify(body), { status })));
}

async function failure(call: () => Promise<unknown>) {
  try {
    await call();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the request to fail');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('what a failed request says', () => {
  it('nothing answering says Selecta can’t be reached and to try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await failure(() => get('/mix'));
    expect(error.message).toBe(OFFLINE_WORDS);
    expect(problemKind(error)).toBe('offline');
  });

  it('a server that broke says the music is safe and to try again, not its own status text', async () => {
    answer(500);
    const error = await failure(() => post('/mix/songs', { song_id: 1 }));
    expect(error.message).toBe(SERVER_FAILED_WORDS);
    expect(problemKind(error)).toBe('server');
  });

  it('a refusal without words of its own still says to try again', async () => {
    answer(400);
    const error = await failure(() => post('/mix/songs', { song_id: 1 }));
    expect(error.message).toMatch(/couldn’t do that.*Try again/);
  });

  it('a read that hangs gives up with words and a next step, and is not called offline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const pending = failure(() => get('/library'));
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toMatch(/taking too long.*Try again/);
  });

  it('the server’s own reason is shown when it gives one, and a conflict is told apart', async () => {
    answer(409, { detail: 'The mix moved on since this page loaded. Refresh to see it.' });
    const error = await failure(() => post('/mix/1/seam', { move: 'cut_on_one' }));
    expect(error.message).toMatch(/moved on/);
    expect(problemKind(error)).toBe('conflict');
  });

  it('every built-in message names the cause and a safe next step in plain words', () => {
    for (const words of [OFFLINE_WORDS, SERVER_FAILED_WORDS, 'Selecta couldn’t do that. Try again.', 'Selecta is taking too long to respond. Try again.']) {
      expect(words).toMatch(NEXT_STEP);
      expect(words).not.toMatch(DEVELOPER);
    }
    // a switched-off feature has no next step to offer, so it names the cause only
    expect(TURNED_OFF_WORDS).toMatch(/turned off/);
    expect(TURNED_OFF_WORDS).not.toMatch(DEVELOPER);
  });
});
