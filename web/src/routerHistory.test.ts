import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPrefs, setPrefs } from './state/prefs';
import { navigate, setQuery, useLocationText } from './router';

/** FL-0477-03: each history entry the router makes carries its place (`idx`), so Back and Forward
 * travel the right way. Entries without one are a jump, and a browser that already animated a
 * swipe back gets no second animation. */

type Doc = { startViewTransition?: unknown };
let directions: (string | undefined)[] = [];

function popTo(path: string, state: unknown, extra: Record<string, unknown> = {}) {
  window.history.replaceState(state, '', path);
  const event = new PopStateEvent('popstate', { state });
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
  act(() => { window.dispatchEvent(event); });
}

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  setPrefs({ motion: 'expressive' });
  directions = [];
  (document as unknown as Doc).startViewTransition = (argument: unknown) => {
    directions.push(document.documentElement.dataset.nav);
    const update = typeof argument === 'function' ? argument : (argument as { update: () => unknown }).update;
    void update();
    return { finished: Promise.resolve(), skipTransition: vi.fn() };
  };
  window.history.replaceState({ idx: 0 }, '', '/listen');
});

afterEach(() => {
  delete (document as unknown as Doc).startViewTransition;
  window.history.replaceState(null, '', '/');
});

describe('FL-0477-03 history entries carry their place', () => {
  it('a push counts on from the entry before, and a replace keeps the place', () => {
    renderHook(() => useLocationText());
    act(() => navigate('/library'));
    expect(window.history.state).toMatchObject({ idx: 1 });
    act(() => navigate('/mixes'));
    expect(window.history.state).toMatchObject({ idx: 2 });
    act(() => navigate('/listening', { replace: true }));
    expect(window.history.state).toMatchObject({ idx: 2 });
    act(() => setQuery({ q: 'drums' }, { push: true }));
    expect(window.history.state).toMatchObject({ idx: 3 });
  });

  it('counts on from the last known place after an entry made elsewhere', () => {
    renderHook(() => useLocationText());
    act(() => navigate('/library'));
    // Cloud's own pushState leaves no idx
    window.history.pushState({}, '', '/elsewhere');
    act(() => navigate('/mixes'));
    expect(window.history.state).toMatchObject({ idx: 2 });
  });
});

describe('FL-0477-03 Back and Forward', () => {
  it('reads the direction from the entries\' places', () => {
    const { result } = renderHook(() => useLocationText());
    act(() => navigate('/library'));
    act(() => navigate('/mixes'));
    directions = [];
    popTo('/library', { idx: 1 });
    expect(directions).toEqual(['back']);
    expect(result.current).toBe('/library');
    popTo('/mixes', { idx: 2 });
    expect(directions).toEqual(['back', 'forward']);
    expect(result.current).toBe('/mixes');
  });

  it('calls an entry without a place a jump', () => {
    renderHook(() => useLocationText());
    act(() => navigate('/library'));
    directions = [];
    popTo('/listening', {});
    expect(directions).toEqual(['jump']);
    popTo('/library', null);
    expect(directions).toEqual(['jump', 'jump']);
  });

  it('gives no second animation to a swipe the browser already animated, but still shows the page', () => {
    const { result } = renderHook(() => useLocationText());
    act(() => navigate('/library'));
    directions = [];
    popTo('/listen', { idx: 0 }, { hasUAVisualTransition: true });
    expect(directions).toEqual([]);
    expect(result.current).toBe('/listen');
  });

  it('animates nothing for a Back that stays on the same page', () => {
    const { result } = renderHook(() => useLocationText());
    act(() => setQuery({ q: 'drums' }, { push: true }));
    directions = [];
    popTo('/listen', { idx: 0 });
    expect(directions).toEqual([]);
    expect(result.current).toBe('/listen');
  });
});
