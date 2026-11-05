import { vi } from 'vitest';
import { MixItem, SeamState, Status } from '../api';

type Answer = unknown | ((body: unknown, url: string) => unknown);

/** A stand-in for the server: answers by route, and remembers what it was asked. */
export function fakeBackend(routes: Record<string, Answer>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ method, path, body });
      const route = routes[`${method} ${path.split('?')[0]}`];
      if (route === undefined) return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
      const answer = typeof route === 'function' ? (route as (b: unknown, u: string) => unknown)(body, path) : route;
      return new Response(JSON.stringify(answer), { status: 200 });
    }),
  );
  return calls;
}

export function seam(status: SeamState['status'], key: string, more: Partial<SeamState> = {}) {
  return { settings: { move: 'bass_swap_blend' }, state: { status, key, passed: true, ...more } };
}

export function songs(...seams: (MixItem['seam'] | undefined)[]): MixItem[] {
  return [null, ...seams].map((item, position) => ({
    position,
    song_id: position + 1,
    artist: `Artist ${position + 1}`,
    title: `Song ${position + 1}`,
    duration: 200,
    bpm: 120,
    key: '8A',
    locked: false,
    seam: item ?? null,
  }));
}

export function status(more: Partial<Status> = {}): Status {
  return {
    counts: { total: 100, music: 90, set_aside: 10, analysed: 50, ready: 40, lyrics: 40 },
    steering: { mix_language: 'balanced' },
    moves: { bass_swap_blend: 'Blend', cut_on_one: 'Cut' },
    analysis_running: false,
    analysing: [],
    mix_rendering: false,
    scan: { status: 'idle' },
    ...more,
  };
}
