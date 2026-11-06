import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { navigate, parseRoute, pathOf, setQuery, useQueryParam, useRoute } from './router';

beforeEach(() => window.history.pushState({}, '', '/'));

describe('addresses', () => {
  it.each([
    ['/', { page: 'mixes', tab: 'browse' }],
    ['/mixes', { page: 'mixes', tab: 'browse' }],
    ['/mixes/mine', { page: 'mixes', tab: 'mine' }],
    ['/listen', { page: 'listen' }],
    ['/library', { page: 'library' }],
    ['/discover', { page: 'discover', tab: 'words' }],
    ['/discover/harmonic', { page: 'discover', tab: 'harmonic' }],
    ['/workshop', { page: 'workshop', tab: 'overview' }],
    ['/workshop/storage', { page: 'workshop', tab: 'storage' }],
    ['/mix/current/edit', { page: 'edit', draft: null }],
    ['/mixes/drafts/7/edit', { page: 'edit', draft: 7 }],
    ['/listen/', { page: 'listen' }],
  ])('%s', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });

  it.each(['/nope', '/workshop/nope', '/mixes/drafts/seven/edit', '/mixes/drafts/7'])('%s isn’t anywhere, and says so', (path) => {
    expect(parseRoute(path).page).toBe('missing');
  });

  it('every page’s address leads back to it', () => {
    for (const path of ['/listen', '/mixes', '/mixes/mine', '/library', '/discover', '/discover/harmonic', '/workshop', '/workshop/sources', '/mix/current/edit', '/mixes/drafts/3/edit']) {
      expect(pathOf(parseRoute(path))).toBe(path);
    }
  });

  it('a draft is always told apart from the current mix', () => {
    expect(pathOf({ page: 'edit', draft: 7 })).not.toBe(pathOf({ page: 'edit', draft: null }));
  });
});

describe('moving around', () => {
  it('follows along, including Back', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ page: 'mixes', tab: 'browse' });
    act(() => navigate('/library'));
    expect(result.current).toEqual({ page: 'library' });
    act(() => navigate('/listen'));
    expect(result.current).toEqual({ page: 'listen' });
    act(() => {
      window.history.replaceState({}, '', '/library');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toEqual({ page: 'library' });
  });

  it('going where you already are adds nothing to Back', () => {
    navigate('/library');
    const before = window.history.length;
    navigate('/library');
    expect(window.history.length).toBe(before);
  });

  it('can replace instead of adding', () => {
    navigate('/library');
    const before = window.history.length;
    navigate('/listen', { replace: true });
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe('/listen');
  });

  it('remembers filters in the address, without adding to Back', () => {
    navigate('/library');
    const before = window.history.length;
    const { result } = renderHook(() => useQueryParam('show'));
    act(() => setQuery({ show: 'priority', q: 'night' }));
    expect(result.current).toBe('priority');
    expect(window.location.search).toBe('?show=priority&q=night');
    expect(window.history.length).toBe(before);
    act(() => setQuery({ show: null }));
    expect(result.current).toBeNull();
    expect(window.location.search).toBe('?q=night');
  });
});
