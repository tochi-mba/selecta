import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type MixData, type Request } from '../api';
import { accountCurrent, conflictWords, CURRENT_MIX_CONFLICT, CURRENT_MIX_EVENT, type AccountCurrent } from './currentMix';
import type { RecipeStore } from './recipeStore';
import { useAccountMix } from './useAccountMix';

// ADR-0475 R8: the account's current mix, the same on every device; set by compare-and-set,
// followed from the event stream, and never switching a speaker that is playing.

afterEach(() => cleanup());

const value = (mix_id: string | null, revision = 1, by: string | null = 'Phone'): AccountCurrent => ({ mix_id, revision, updated_at: 1, updated_by_device_name: by });

/** A pretend account: `server` is its current mix; PUT is compare-and-set as the server does it. */
function account(start: string | null) {
  let server = value(start, 0, null);
  const puts: { mix_id: string | null; expected_mix_id: string | null }[] = [];
  const cloud = (async (path: string, init?: RequestInit) => {
    if (path !== '/local-media/current') throw new Error(path);
    if (init?.method !== 'PUT') return server;
    const body = JSON.parse(String(init.body)) as { mix_id: string | null; expected_mix_id: string | null };
    puts.push(body);
    if (server.mix_id !== body.mix_id && server.mix_id !== body.expected_mix_id) throw new ApiError('changed', 409, 'current_mix_changed');
    server = value(body.mix_id, server.revision + 1, 'This browser');
    return server;
  }) as Request;
  let pointer: string | null = null;
  const store = { read: () => pointer, write: (next: string | null) => { pointer = next; } };
  return { cloud, puts, store, set: (next: AccountCurrent) => { server = next; }, pointer: () => pointer };
}

describe('setting the current mix', () => {
  it('compares against what this device last saw, so a late choice never overwrites another device', async () => {
    const world = account('one');
    const mine = accountCurrent(world.cloud, 'ws', world.store);
    await mine.sync();
    // another device chose 'two' a moment ago; this one still thinks 'one' is current
    world.set(value('two', 5, 'Laptop'));
    const told = vi.fn();
    window.addEventListener(CURRENT_MIX_CONFLICT, told);
    await mine.tell('three');
    window.removeEventListener(CURRENT_MIX_CONFLICT, told);
    expect(world.puts.at(-1)).toEqual({ mix_id: 'three', expected_mix_id: 'one', device_id: null });
    // the account's value is taken here, and the person is told by which device
    expect(world.pointer()).toBe('two');
    expect(told).toHaveBeenCalledTimes(1);
    expect(conflictWords('Laptop')).toBe('Laptop chose a different mix a moment ago. That one is now current; yours is saved in My Mixes.');
  });

  it('upgrades a mix remembered only by this browser into the account, once', async () => {
    const world = account(null);
    world.store.write('kept');
    const mine = accountCurrent(world.cloud, 'ws', world.store);
    expect((await mine.sync()).mix_id).toBe('kept');
    expect(world.puts).toEqual([{ mix_id: 'kept', expected_mix_id: null, device_id: null }]);
    // the account has one now: the next look takes it, and sends nothing
    await mine.sync();
    expect(world.puts).toHaveLength(1);
  });

  it('a connection that is down leaves this browser’s choice standing', async () => {
    const down = (async () => { throw new TypeError('Failed to fetch'); }) as Request;
    let pointer: string | null = 'mine';
    const mine = accountCurrent(down, 'ws', { read: () => pointer, write: (next) => { pointer = next; } });
    await mine.tell('mine');
    expect(pointer).toBe('mine');
  });
});

function Harness({ recipes, audible, onPlay }: { recipes: RecipeStore; audible: boolean; onPlay: () => void }) {
  const request = (async () => ({ mix: [{ position: 0, song_id: 1 }], name: 'New', can_undo: false }) as unknown as MixData) as Request;
  const mix = useAccountMix({ recipes, request, refreshMix: vi.fn(), setMixData: vi.fn(), audibleHere: audible, playHere: onPlay, askToPlay: vi.fn() });
  return <>{mix.banner}</>;
}

function store(start: string | null, server: AccountCurrent) {
  let pointer = start;
  const recipes = {
    current: () => pointer,
    setCurrent: vi.fn((next: string | null) => { pointer = next; }),
    account: { sync: async () => server, heard: vi.fn(), seen: () => server, tell: vi.fn() },
  } as unknown as RecipeStore;
  return recipes;
}

describe('following the account on an open device', () => {
  it('a device that is not playing takes another device’s new mix without a reload', async () => {
    const recipes = store('old', value('old', 1));
    render(<Harness recipes={recipes} audible={false} onPlay={vi.fn()} />);
    act(() => { window.dispatchEvent(new CustomEvent(CURRENT_MIX_EVENT, { detail: value('new', 2, 'Phone') })); });
    await waitFor(() => expect(recipes.current()).toBe('new'));
    expect(screen.queryByTestId('new-mix-arrived')).toBeNull();
  });

  it('an old value replayed to a device that just connected is not taken, so it is never told back', async () => {
    // seen on 2026-11-25 (ctl19): a fresh tablet's event stream replayed old mix.current events,
    // the tablet took each, told the account, and the playing laptop said "made a new mix"
    const recipes = store('now', value('now', 9));
    render(<Harness recipes={recipes} audible={false} onPlay={vi.fn()} />);
    await waitFor(() => expect(recipes.account!.heard).toHaveBeenCalled());
    (recipes.setCurrent as ReturnType<typeof vi.fn>).mockClear();
    act(() => { for (const [mix, revision] of [['a', 3], ['b', 4], ['c', 8]] as const) window.dispatchEvent(new CustomEvent(CURRENT_MIX_EVENT, { detail: value(mix, revision, 'Old phone') })); });
    expect(recipes.setCurrent).not.toHaveBeenCalled();
    expect(recipes.current()).toBe('now');
  });

  it('the speaker keeps playing, and offers the new mix until a choice is made', async () => {
    const recipes = store('old', value('old', 1));
    const onPlay = vi.fn();
    render(<Harness recipes={recipes} audible onPlay={onPlay} />);
    act(() => { window.dispatchEvent(new CustomEvent(CURRENT_MIX_EVENT, { detail: value('new', 2, 'Phone') })); });
    expect(await screen.findByTestId('new-mix-arrived')).toHaveTextContent('Phone made a new mix.');
    expect(recipes.current()).toBe('old');
    await act(async () => { screen.getByRole('button', { name: 'Play it now' }).click(); });
    await waitFor(() => expect(onPlay).toHaveBeenCalled());
    expect(recipes.current()).toBe('new');
  });

  it('Keep playing leaves the speaker on its mix and starts nothing later', async () => {
    const recipes = store('old', value('old', 1));
    const onPlay = vi.fn();
    render(<Harness recipes={recipes} audible onPlay={onPlay} />);
    act(() => { window.dispatchEvent(new CustomEvent(CURRENT_MIX_EVENT, { detail: value('new', 2, 'Phone') })); });
    await act(async () => { (await screen.findByRole('button', { name: 'Keep playing' })).click(); });
    expect(screen.queryByTestId('new-mix-arrived')).toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
    expect(recipes.current()).toBe('old');
  });
});

describe('with cloud.local_media off (the routes refused)', () => {
  it('behaves as before: the browser keeps its own current mix and nothing is shown', async () => {
    const refused = (async () => { throw new ApiError('That feature is off.', 403, 'flag_off'); }) as Request;
    let pointer: string | null = 'mine';
    const mine = accountCurrent(refused, 'ws', { read: () => pointer, write: (next) => { pointer = next; } });
    await mine.tell('other');
    expect(pointer).toBe('mine');
    await expect(mine.sync()).rejects.toMatchObject({ status: 403 });
    // the shell's follower swallows the refusal and changes nothing
    const recipes = { current: () => pointer, setCurrent: vi.fn(), account: mine } as unknown as RecipeStore;
    render(<Harness recipes={recipes} audible={false} onPlay={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recipes.setCurrent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-mix-arrived')).toBeNull();
  });
});
