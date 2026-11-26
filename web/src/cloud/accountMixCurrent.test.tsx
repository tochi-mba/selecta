import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixData, Request } from '../api';
import { setFlags } from '../flags';
import { CURRENT_MIX_EVENT, isAccountTurn, type AccountTurn } from './currentMix';
import type { RecipeStore } from './recipeStore';
import { useAccountMix } from './useAccountMix';

// cloud.account_mixes: the account keeps the current mix, and its `mix.current` events say what
// it now is (cloud_brain/mix_current.py). A device already showing it does nothing, another reads
// it again, and the speaker keeps playing and is offered it.

beforeEach(() => setFlags({ 'cloud.brain': true, 'cloud.account_mixes': true }));
afterEach(() => { cleanup(); setFlags(null); });

const turn = (order: string, at: number, by: string | null = 'Laptop'): AccountTurn => ({ account: true, order, songs: order ? order.split(',').length : 0, name: 'Friday', updated_at: at, updated_by_device_name: by });
const say = (value: unknown) => act(() => { window.dispatchEvent(new CustomEvent(CURRENT_MIX_EVENT, { detail: value })); });

function recipes() {
  return { current: () => 'recipe-1', setCurrent: vi.fn(), read: vi.fn() } as unknown as RecipeStore;
}

function Harness({ store, audible, held, refreshMix, setMixData, onPlay, request }: {
  store: RecipeStore; audible: boolean; held: () => string; refreshMix: () => void; setMixData: (data: MixData) => void; onPlay: () => void; request: Request;
}) {
  const mix = useAccountMix({ recipes: store, request, refreshMix, setMixData, audibleHere: audible, playHere: onPlay, askToPlay: vi.fn(), heldOrder: held });
  return <>{mix.banner}</>;
}

function shown(audible: boolean, held = '1,2') {
  const order = { now: held };
  const refreshMix = vi.fn();
  const setMixData = vi.fn((data: MixData) => { order.now = data.mix.map((item) => item.song_id).join(','); });
  const onPlay = vi.fn();
  const mix: MixData = { mix: [{ position: 0, song_id: 3 }, { position: 1, song_id: 4 }] as MixData['mix'], name: 'Friday', can_undo: true };
  const request = vi.fn(async () => mix) as unknown as Request;
  const store = recipes();
  render(<Harness store={store} audible={audible} held={() => order.now} refreshMix={refreshMix} setMixData={setMixData} onPlay={onPlay} request={request} />);
  return { refreshMix, setMixData, onPlay, request, store, order };
}

describe('following the account’s own current mix', () => {
  it('knows an account event from a recipe one', () => {
    expect(isAccountTurn(turn('1,2', 1))).toBe(true);
    expect(isAccountTurn({ mix_id: 'recipe-1', revision: 2, updated_at: 1, updated_by_device_name: null })).toBe(false);
    expect(isAccountTurn(null)).toBe(false);
  });

  it('a device that is not playing reads the new mix again, and never takes it as a recipe', () => {
    const { refreshMix, store } = shown(false);
    say(turn('3,4', 10));
    expect(refreshMix).toHaveBeenCalledTimes(1);
    expect(store.setCurrent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-mix-arrived')).toBeNull();
  });

  it('a device already showing that order does nothing: it made it, or has it', () => {
    const { refreshMix } = shown(false, '3,4');
    say(turn('3,4', 10));
    expect(refreshMix).not.toHaveBeenCalled();
  });

  it('an older change replayed after a newer one is passed over', () => {
    const { refreshMix } = shown(false);
    say(turn('3,4', 10));
    say(turn('5,6', 4));
    expect(refreshMix).toHaveBeenCalledTimes(1);
  });

  it('the speaker keeps playing, offers the new mix by its device, and Play it now plays the account’s', async () => {
    const { refreshMix, setMixData, onPlay, request } = shown(true);
    say(turn('3,4', 10, 'Phone'));
    expect(await screen.findByTestId('new-mix-arrived')).toHaveTextContent('Phone made a new mix.');
    expect(refreshMix).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole('button', { name: 'Play it now' }).click(); });
    await waitFor(() => expect(onPlay).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith('/mix');
    expect(setMixData).toHaveBeenCalledWith(expect.objectContaining({ name: 'Friday' }));
  });

  it('the speaker’s offer goes once the order it shows is the account’s, and a cleared mix is not offered', async () => {
    shown(true);
    say(turn('3,4', 10));
    expect(await screen.findByTestId('new-mix-arrived')).toBeInTheDocument();
    say(turn('1,2', 11));
    expect(screen.queryByTestId('new-mix-arrived')).toBeNull();
    say(turn('', 12));
    expect(screen.queryByTestId('new-mix-arrived')).toBeNull();
  });

  it('Keep playing leaves the speaker on its mix', async () => {
    const { onPlay } = shown(true);
    say(turn('3,4', 10));
    await act(async () => { (await screen.findByRole('button', { name: 'Keep playing' })).click(); });
    expect(screen.queryByTestId('new-mix-arrived')).toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('with account mixes off, an account event changes nothing', () => {
    setFlags({ 'cloud.brain': true, 'cloud.account_mixes': false });
    const { refreshMix } = shown(false);
    say(turn('3,4', 10));
    expect(refreshMix).not.toHaveBeenCalled();
  });
});
