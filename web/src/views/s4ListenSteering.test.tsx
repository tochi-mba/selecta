import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixItem } from '../api';
import { SetPlayer } from '../player';
import { status } from '../test/backend';
import { Now } from './Now';

/**
 * S4-0098-07: Bigger, Calmer and Something else say what actually happened. A request the server
 * accepted without choosing a different song is never announced as a new song, and a refusal
 * announces nothing at all.
 */
const song = (position: number, id: number, title: string): MixItem => ({
  position, song_id: id, artist: 'Artist', title, duration: 20, bpm: 120, key: '8A', locked: false, seam: null,
});
const tracks = [song(0, 1, 'Now Playing'), song(1, 2, 'Next Song')];

function show(reply: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/mix/1/swap') && init?.method === 'POST') return reply();
    return new Response('{}', { status: 200 });
  }));
  const player = new SetPlayer(() => tracks, () => {});
  const notify = vi.fn();
  const setMixData = vi.fn();
  render(
    <Now
      status={status()}
      mix={tracks}
      mixName="Test mix"
      canUndo={false}
      refreshMix={() => {}}
      setMixData={setMixData}
      refreshStatus={() => {}}
      player={player}
      now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
      setView={() => {}}
      notify={notify}
      stage={false}
      toggleStage={() => {}}
    />,
  );
  return { notify, setMixData };
}

afterEach(() => vi.unstubAllGlobals());

describe('S4-0098-07 steering intent versus result', () => {
  it('a different song chosen is announced as the new next song', async () => {
    const { notify } = show(() => new Response(JSON.stringify({ mix: [tracks[0], song(1, 9, 'Bigger One')] }), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Bigger' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Next up: Bigger One.', true));
  });

  it('an accepted request that keeps the same song says so, and never claims a swap', async () => {
    const { notify } = show(() => new Response(JSON.stringify({ mix: tracks }), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Calmer' }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith('Nothing else fits there, so Next Song stays next.', true);
    expect(notify.mock.calls[0][0]).not.toMatch(/^Next up/);
  });

  it('a refused request shows the reason and announces no new song', async () => {
    const { notify, setMixData } = show(() => new Response(JSON.stringify({ detail: 'No other song fits here.' }), { status: 409 }));
    fireEvent.click(screen.getByRole('button', { name: 'Something else' }));
    await screen.findByText(/No other song fits here/);
    expect(notify).not.toHaveBeenCalled();
    expect(setMixData).not.toHaveBeenCalled();
  });
});

/**
 * S4-0098-08: a rating belongs to the transition actually heard. If the listener moves through another
 * transition while the rating is saving, the late answer is stored against the old key and never marks
 * the newer transition as rated.
 */
describe('S4-0098-08 rating follows the heard transition', () => {
  it('a late rating answer never attaches to a newer transition', async () => {
    const posts: string[] = [];
    let finish: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/rate') && init?.method === 'POST') {
        posts.push(url);
        await new Promise<void>((done) => { finish = done; });
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    const player = new SetPlayer(() => tracks, () => {});
    const notify = vi.fn();
    const props = (key: string) => ({
      status: status(), mix: tracks, mixName: 'Test mix', canUndo: false,
      refreshMix: () => {}, setMixData: () => {}, refreshStatus: () => {}, player,
      now: { ...player.state, phase: 'playing' as const, position: 0, songTime: 2, duration: 20, lastSeamKey: key },
      setView: () => {}, notify, stage: false, toggleStage: () => {},
    });
    const { rerender } = render(<Now {...props('heard-first')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toContain('/seams/heard-first/rate');
    rerender(<Now {...props('heard-second')} />);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Good' })).not.toHaveAttribute('aria-disabled'));
    expect(notify).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Rate that transition' })).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });
});
