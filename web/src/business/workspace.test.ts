import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from './apiTypes';
import { canSwitch, createWorkspaceStore, rememberedWorkspace, storageKey, SWITCH_REASONS, workspaceLabel, WorkspaceState } from './workspace';

const personal: Workspace = { id: 'p1', name: 'Personal', kind: 'personal', role: 'owner', pilot_until: null };
const crown: Workspace = { id: 'b1', name: 'The Crown Group', kind: 'business', role: 'venue_manager', pilot_until: null };
const both = [personal, crown];

const state = (over: Partial<WorkspaceState> = {}): WorkspaceState => ({
  userId: 'u1', workspaces: both, currentId: 'p1', holdsZoneLease: false, playingPersonal: false, online: true, ...over,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('workspace store', () => {
  it('opens personal by default and remembers a switch per person and per tab', () => {
    const store = createWorkspaceStore({ userId: 'u1', workspaces: both });
    expect(store.getState().currentId).toBe('p1');
    const result = store.switchTo('b1');
    expect(result.ok).toBe(true);
    expect(store.getState().currentId).toBe('b1');
    expect(localStorage.getItem(storageKey('u1'))).toBe('b1');
    expect(rememberedWorkspace('u1')).toBe('b1');
    expect(createWorkspaceStore({ userId: 'u1', workspaces: both }).getState().currentId).toBe('b1');
    // Another person on the same browser keeps their own choice.
    expect(createWorkspaceStore({ userId: 'u2', workspaces: both }).getState().currentId).toBe('p1');
  });

  it('falls back to personal when the remembered workspace is no longer listed', () => {
    localStorage.setItem(storageKey('u1'), 'gone');
    expect(createWorkspaceStore({ userId: 'u1', workspaces: both }).getState().currentId).toBe('p1');
  });

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const store = createWorkspaceStore({ userId: 'u1', workspaces: both });
    expect(store.getState().currentId).toBe('p1');
    expect(store.switchTo('b1').ok).toBe(true);
    expect(store.getState().currentId).toBe('b1');
    expect(rememberedWorkspace('u1')).toBeNull();
  });

  it('tells subscribers about a switch', () => {
    const store = createWorkspaceStore({ userId: 'u1', workspaces: both });
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.switchTo('b1');
    stop();
    store.switchTo('p1');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('refuses while this device holds a zone lease, even when confirmed', () => {
    const store = createWorkspaceStore({ userId: 'u1', workspaces: both });
    store.switchTo('b1');
    store.setDevice({ holdsZoneLease: true });
    const result = store.switchTo('p1', { confirmed: true });
    expect(result).toMatchObject({ ok: false, code: 'zone_lease', reason: SWITCH_REASONS.zone_lease, confirmable: false });
    expect(store.getState().currentId).toBe('b1');
  });

  it('asks before leaving personal music playing, and switches once confirmed', () => {
    const store = createWorkspaceStore({ userId: 'u1', workspaces: both });
    store.setDevice({ playingPersonal: true });
    expect(store.switchTo('b1')).toMatchObject({ ok: false, code: 'playing_personal', confirmable: true });
    expect(store.getState().currentId).toBe('p1');
    expect(store.switchTo('b1', { confirmed: true }).ok).toBe(true);
    expect(store.getState().currentId).toBe('b1');
  });

  it('keeps the current workspace when a fresh list still has it', () => {
    const store = createWorkspaceStore({ userId: 'u1', workspaces: both });
    store.switchTo('b1');
    store.setWorkspaces([personal, crown, { ...crown, id: 'b2', name: 'Harbour Bars' }]);
    expect(store.getState().currentId).toBe('b1');
    store.setWorkspaces([personal]);
    expect(store.getState().currentId).toBe('p1');
  });
});

describe('canSwitch', () => {
  it('names the reason, or null when the switch can go ahead', () => {
    expect(canSwitch(state(), 'b1')).toBeNull();
    expect(canSwitch(state(), 'p1')).toBeNull();
    expect(canSwitch(state({ online: false }), 'b1')).toBe("You're offline. Switch when you're back.");
    expect(canSwitch(state({ holdsZoneLease: true, currentId: 'b1' }), 'p1')).toBe(SWITCH_REASONS.zone_lease);
    expect(canSwitch(state({ playingPersonal: true }), 'b1')).toBe('Your music is playing here. Keep it playing while you switch?');
    expect(canSwitch(state(), 'nope')).toBe(SWITCH_REASONS.unknown);
    expect(canSwitch(state({ holdsZoneLease: true }))).toBe(SWITCH_REASONS.zone_lease);
  });

  it('only asks about personal music when the current workspace is personal', () => {
    expect(canSwitch(state({ playingPersonal: true, currentId: 'b1' }), 'p1')).toBeNull();
  });
});

describe('workspaceLabel', () => {
  it('says Personal or the organisation with the role', () => {
    expect(workspaceLabel(personal)).toBe('Personal');
    expect(workspaceLabel(crown)).toBe('The Crown Group, venue manager');
  });
});
