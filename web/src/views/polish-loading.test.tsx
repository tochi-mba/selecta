import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';
import { Now } from './Now';

/** UI/UX polish ADR-0036 P0041: failed retrieval in the transition inspector becomes an honest
 * error with Retry beside it (never an endless skeleton), for its options and its Studio check. */

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const refs = { mix };
  const player = new SetPlayer(() => refs.mix, () => {});
  return (
    <Mix
      status={status()} mix={mix} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}}
      player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}}
    />
  );
}

const options = {
  moves: [{ name: 'bass_swap_blend', label: 'Blend', description: 'Swap the basslines.', available: true, reason: null }],
  exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'],
  studio: { available: true, reason: null },
};

describe('P0041 inspector retrieval failures', () => {
  it('a failed options read says what failed and offers Try again, which recovers', async () => {
    let fail = true;
    fakeBackend({ 'GET /mix/1/options': () => (fail ? new Reply(500, { detail: 'The server could not work out the moves.' }) : options) });
    render(<Harness start={songs(seam('ready', 'a', { label: 'Blend', style: 'bass_swap_blend', preview_seam: 20 }))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    const side = screen.getByRole('complementary', { name: 'This transition' });
    await userEvent.click(within(side).getByRole('tab', { name: 'Change' }));
    const alert = await within(side).findByRole('alert');
    expect(alert).toHaveTextContent('The server could not work out the moves.');
    expect(within(side).queryByRole('status', { name: 'Working out what’s possible' })).toBeNull();
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(side).findByRole('button', { name: 'Blend' })).toBeInTheDocument();
  });

  it('a failed Studio availability check is an error with Try again, not a spinner', async () => {
    fakeBackend({ 'GET /mix/1/options': new Reply(500, { detail: 'Server error' }) });
    render(<Harness start={songs(seam('ready', 'a', { label: 'Blend', style: 'bass_swap_blend', preview_seam: 20 }))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    const side = screen.getByRole('complementary', { name: 'This transition' });
    await userEvent.click(within(side).getByRole('tab', { name: 'Studio' }));
    const alert = await within(side).findByText('Couldn’t check Studio availability.');
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('P0041 failed Listen details', () => {
  it('says the details could not load, keeps playback controls, and Try again recovers', async () => {
    const item: MixItem = { position: 0, song_id: 7, artist: 'A', title: 'Song', duration: 60, bpm: 120, key: '8A', locked: false, seam: null };
    const detail = { id: 7, artist: 'A', title: 'Song', duration: 60, bpm: 120, key: '8A', peaks: [], sections: [], lyric_status: 'plain', lines: [] } as unknown as SongDetail;
    let fail = true;
    fakeBackend({ 'GET /status': status(), 'GET /songs/7': () => (fail ? new Reply(500, { detail: 'Server error' }) : detail) });
    const player = new SetPlayer(() => [item], () => {});
    render(
      <Now status={status()} mix={[item]} mixName="Mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 60 }}
        setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
    );
    const alert = (await screen.findByText(/Couldn’t load (lyrics and song details|this song’s details)\. Playback controls are still available\./)).closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Lyrics for this song aren’t timed, so they can’t follow along.')).toBeInTheDocument();
    expect(screen.queryByText(/Playback controls are still available/)).toBeNull();
  });
});
