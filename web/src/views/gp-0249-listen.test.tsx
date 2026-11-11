import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/** GP-0249-05: planned versus made is explained once, under Up Next, not again in Why this transition.
 * GP-0249-06: lyrics, steering and requests stay findable while DJ controls are closed.
 * GP-0249-07: changing what the page shows never touches playback, and keyboard focus stays put. */

const song = (id: number, more: Partial<MixItem> = {}) => ({
  position: id - 1, song_id: id, artist: 'Test Artist', title: `Song ${id}`, duration: 20, bpm: 120, key: '8A', locked: false, seam: null, ...more,
}) as MixItem;
const detail: SongDetail = {
  id: 1, artist: 'Test Artist', title: 'Song 1', duration: 20, bpm: 120, key: '8A', peaks: [], bar_times: [0, 8, 16],
  beat_times: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18], beats_per_bar: 4, sections: [], lines: [{ start: 0, end: 2, text: 'Hello there' }],
};
const planned = { settings: { move: 'bass_swap_blend' }, state: { status: 'planned', why: 'Close in tempo and key' } };
const fellBack = { settings: { move: 'echo_out' }, state: { status: 'ready', label: 'Blend', style: 'blend', passed: true, why: 'Close in tempo and key' } };

function listen(tracks: MixItem[], more: { openRequests?: () => void } = {}) {
  const player = new SetPlayer(() => tracks, () => {});
  const spies = (['togglePause', 'pause', 'seek', 'next', 'previous'] as const).map((name) => vi.spyOn(player, name as never));
  const view = render(
    <Now status={status()} mix={tracks} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20 }}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} openRequests={more.openRequests} />,
  );
  return { ...view, spies };
}

beforeEach(() => {
  window.localStorage.removeItem('selecta.listen');
  fakeBackend({ 'GET /songs/1': detail, 'GET /songs/2': { ...detail, id: 2, title: 'Song 2' } });
});

describe('GP-0249-05 one explanation of planned versus made', () => {
  it.each([
    ['a planned transition', planned, /Planned: .*It hasn’t been made yet/],
    ['a made transition that fell back from the move asked for', fellBack, /You asked for .*What will play is Blend/],
  ])('%s is explained under Up Next and not repeated in Why this transition', async (_, seam, words) => {
    const { container } = listen([song(1), song(2, { seam: seam as never })]);
    await screen.findByText('Hello there');
    const upNext = container.querySelector('.next-up') as HTMLElement;
    expect(within(upNext).getByText(words)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Why this transition?'));
    const why = screen.getByText('Why this transition?').closest('details') as HTMLElement;
    expect(within(why).getByText('Close in tempo and key')).toBeInTheDocument();
    expect(within(why).queryByText(words)).toBeNull();
    expect(within(why).queryByText(/Not rendered yet|will play, because/)).toBeNull();
    // across the whole page each explanation appears exactly once
    expect(screen.getAllByText(words)).toHaveLength(1);
  });
});

describe('GP-0249-06 lyrics, steering and requests stay discoverable', () => {
  it('with DJ controls closed the lyric shows, Up Next leads to steering and Request a song is one step away', async () => {
    const openRequests = vi.fn();
    const { container } = listen([song(1), song(2)], { openRequests });
    const advanced = container.querySelector('details.dj-controls') as HTMLDetailsElement;
    expect(advanced).not.toHaveAttribute('open');
    // lyrics are in the foreground, never behind the disclosure
    const lyric = await screen.findByText('Hello there');
    expect(advanced.contains(lyric)).toBe(false);
    // steering: a visible way in from Up Next that opens DJ controls at the steering choices
    const steer = within(container.querySelector('.next-up') as HTMLElement).getByRole('button', { name: 'Change the next song' });
    expect(steer).toHaveAccessibleDescription('Opens DJ controls at Bigger, Calmer and Something else');
    fireEvent.click(steer);
    await waitFor(() => expect(advanced).toHaveAttribute('open'));
    expect(screen.getByRole('heading', { name: 'Change the next song' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Bigger' })).toBeVisible();
    // the way in steps aside once DJ controls are open, so nothing is offered twice
    expect(screen.queryByRole('button', { name: 'Change the next song' })).toBeNull();
    // requests: one press, with the shortcut named
    fireEvent.click(screen.getByRole('button', { name: /^Request a song/ }));
    expect(openRequests).toHaveBeenCalledTimes(1);
  });

  it('the last song offers no steering way in, because there is no next song to change', async () => {
    const { container } = listen([song(1)]);
    await screen.findByText('Hello there');
    expect(within(container.querySelector('.next-up') as HTMLElement).queryByRole('button', { name: 'Change the next song' })).toBeNull();
  });
});

describe('GP-0249-07 visual changes keep playback and focus', () => {
  it('panels, visualizer style and intensity change without touching the player or moving focus', async () => {
    const { container, spies } = listen([song(1), song(2)]);
    await screen.findByText('Hello there');
    fireEvent.click(container.querySelector('details.dj-controls > summary')!);
    const pause = screen.getByRole('button', { name: 'Pause' });
    const panels = screen.getByRole('group', { name: 'Visible listening panels' });
    for (const name of ['Lyrics focus', 'Spectrum', 'Beat countdown']) {
      const toggle = within(panels).getByRole('button', { name });
      const before = toggle.getAttribute('aria-pressed');
      toggle.focus();
      fireEvent.click(toggle);
      expect(toggle, name).toHaveFocus();
      expect(toggle.getAttribute('aria-pressed'), name).not.toBe(before);
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-pressed'), name).toBe(before);
    }
    const style = screen.getByRole('combobox', { name: 'Audio visualizer style' });
    style.focus();
    fireEvent.change(style, { target: { value: (style as HTMLSelectElement).options[7].value } });
    expect(style).toHaveFocus();
    const quiet = screen.getByRole('button', { name: 'Quiet visuals' });
    quiet.focus();
    fireEvent.click(quiet);
    expect(quiet).toHaveFocus();
    expect(quiet).toHaveAttribute('aria-pressed', 'true');
    // the transport is the same element with the same name, and nothing asked the player to do anything
    expect(screen.getByRole('button', { name: 'Pause' })).toBe(pause);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // the lyric stays in the accessibility tree through every change
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });
});
