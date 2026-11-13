import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../cloud/api';
import { setFlags } from '../flags';
import { useWorkspaces, withPersonal } from './useWorkspaces';

const personal = { id: 'p1' };
const listed = {
  workspaces: [
    { id: 'b1', name: 'The Crown Group', kind: 'business', role: 'owner', pilot_until: 1_900_000_000 },
    { id: 'p1', name: 'Me', kind: 'personal', role: 'owner', pilot_until: null },
  ],
};

function fakeApi(answer: unknown = listed) {
  const calls: { path: string; workspace?: string }[] = [];
  const api = vi.fn(async (path: string, _init?: RequestInit, workspace?: string) => {
    calls.push({ path, workspace });
    return answer;
  }) as unknown as Api;
  return { api, calls };
}

describe('useWorkspaces', () => {
  it('with the flag off asks nothing and answers only the personal workspace', async () => {
    setFlags({ 'business.workspaces': false });
    const { api, calls } = fakeApi();
    const { result } = renderHook(() => useWorkspaces({ api, userId: 'u1', personal }));
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual([]);
    expect(result.current.enabled).toBe(false);
    expect(result.current.workspaces.map((w) => w.id)).toEqual(['p1']);
    expect(result.current.current).toMatchObject({ id: 'p1', kind: 'personal', name: 'Personal' });
    expect(result.current.showSwitcher).toBe(false);
  });

  it('asks nothing before the server has said which flags are on', async () => {
    setFlags(null);
    const { api, calls } = fakeApi();
    renderHook(() => useWorkspaces({ api, userId: 'u1', personal }));
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual([]);
  });

  it('with cloud account features, needs the flag on explicitly', async () => {
    const { api, calls } = fakeApi();
    renderHook(() => useWorkspaces({ api, userId: 'u1', personal, features: {} }));
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual([]);
  });

  it('with the flag on loads the list, personal first, and can switch', async () => {
    const { api, calls } = fakeApi();
    const { result } = renderHook(() => useWorkspaces({ api, userId: 'u1', personal, features: { 'business.workspaces': true } }));
    await waitFor(() => expect(result.current.workspaces).toHaveLength(2));
    expect(calls).toEqual([{ path: '/workspaces', workspace: 'p1' }]);
    expect(result.current.workspaces.map((w) => w.id)).toEqual(['p1', 'b1']);
    expect(result.current.showSwitcher).toBe(true);
    act(() => { result.current.switchTo('b1'); });
    expect(result.current.current.id).toBe('b1');
  });

  it('keeps personal only when the list fails to load', async () => {
    const api = vi.fn(async () => { throw new Error('down'); }) as unknown as Api;
    const { result } = renderHook(() => useWorkspaces({ api, userId: 'u1', personal, features: { 'business.workspaces': true } }));
    await waitFor(() => expect(result.current.error).toBe("Couldn't load your workspaces."));
    expect(result.current.workspaces.map((w) => w.id)).toEqual(['p1']);
  });
});

describe('withPersonal', () => {
  it('adds the personal workspace when the server leaves it out', () => {
    const own = { id: 'p1', name: 'Personal', kind: 'personal' as const, role: 'owner', pilot_until: null };
    const biz = { id: 'b1', name: 'Crown', kind: 'business' as const, role: 'staff', pilot_until: null };
    expect(withPersonal([biz], own).map((w) => w.id)).toEqual(['p1', 'b1']);
  });
});
