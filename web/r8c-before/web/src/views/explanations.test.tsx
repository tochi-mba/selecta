import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/* Selecta 2.0 T0135 (ADR-0027): explanatory fallback, missing backend factors, a stale rating and
 * the live-region part of screen-reader announcements. Hearing it in NVDA/VoiceOver needs a person. */

const detail: SongDetail = {
  id: 1, artist: 'Test Artist', title: 'Test Song', duration: 20, bpm: 120, key: '8A', peaks: [],
  bar_times: [], beat_times: [], beats_per_bar: 4, sections: [], lines: [],
};

const first: MixItem = { position: 0, song_id: 1, artist: 'Test Artist', title: 'Test Song', duration: 20, bpm: 120, key: '8A', locked: false, seam: null };

function mixWith(state: Record<string, unknown>): MixItem[] {
  return [first, { ...first, position: 1, song_id: 2, title: 'Next Song', seam: { settings: { move: 'bass_swap_blend' }, state: { passed: true, ...state } } as never }];
}

function listen(tracks: MixItem[], more: { lastSeamKey?: string | null; notify?: (message: string) => void; notice?: string } = {}) {
  const player = new SetPlayer(() => tracks, () => {});
  return (
    <Now
      status={status()} mix={tracks} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player}
      now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 20, lastSeamKey: more.lastSeamKey ?? null, notice: more.notice ?? '' }}
      setView={() => {}} notify={more.notify ?? (() => {})} stage={false} toggleStage={() => {}}
    />
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('T0135 explanatory fallback', () => {
  it('a transition not made yet says the music carries on with a fade if it is late', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    render(listen(mixWith({ status: 'queued', key: 'k1' })));
    expect(await screen.findByText(/If it isn’t ready in time, this song plays on and the next one fades in/)).toBeInTheDocument();
  });

  it('a failed transition says Selecta falls back to its own pick, not that it is ready', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    render(listen(mixWith({ status: 'failed', key: 'k1' })));
    expect(await screen.findByText(/Selecta falls back to its own pick/)).toBeInTheDocument();
    expect(screen.queryByText(/What was measured on the finished audio/)).toBeNull();
  });
});

describe('T0135 missing backend factors', () => {
  it('with no reason, attempts or checks from the server, Why invents none', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    render(listen(mixWith({ status: 'ready', key: 'k1' })));
    fireEvent.click(await screen.findByText('Why this transition?'));
    const why = screen.getByText('Why this transition?').closest('details')!;
    expect(within(why).queryByText(/Also tried/)).toBeNull();
    expect(within(why).queryByText(/What was measured/)).toBeNull();
    expect(within(why).queryAllByRole('listitem')).toHaveLength(0);
    // only measured tempo and key are shown
    expect(within(why).getByText('120 → 120 BPM · 8A → 8A')).toBeInTheDocument();
  });
});

describe('T0135 stale rating', () => {
  it('a rating that answers after the next transition played is not applied to the new one', async () => {
    let answer: (response: Response) => void = () => {};
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(url);
        return new Promise<Response>((done) => { answer = done; });
      }
      return Promise.resolve(new Response(JSON.stringify(detail), { status: 200 }));
    }));
    const notify = vi.fn();
    const tracks = mixWith({ status: 'ready', key: 'k2' });
    const { rerender } = render(listen(tracks, { lastSeamKey: 'old-k', notify }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Rate that transition' })).getByRole('button', { name: 'Good' }));
    await waitFor(() => expect(posted).toEqual(['/api/seams/old-k/rate']));
    // another transition plays before the server answers
    rerender(listen(tracks, { lastSeamKey: 'new-k', notify }));
    await act(async () => { answer(new Response('{}', { status: 200 })); });
    expect(notify).not.toHaveBeenCalled();
    // the new transition can still be rated on its own
    expect(screen.getByRole('group', { name: 'Rate that transition' })).toBeInTheDocument();
    expect(posted).toEqual(['/api/seams/old-k/rate']);
  });
});

describe('T0135 screen-reader announcements (automated part)', () => {
  it('a player notice is announced through a polite status region, never an assertive interruption', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    const { container } = render(listen(mixWith({ status: 'ready', key: 'k1' }), { notice: 'That seam wasn’t ready in time, so this one faded in.' }));
    const notice = await screen.findByText('That seam wasn’t ready in time, so this one faded in.');
    expect(notice).toHaveAttribute('role', 'status');
    expect(container.querySelector('[aria-live="assertive"]')).toBeNull();
  });
});
