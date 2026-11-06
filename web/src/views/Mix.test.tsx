import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MixData, MixItem, Status } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Adder, Mix } from './Mix';

function Harness({ start, state = status(), notify = () => {} }: { start: MixItem[]; state?: Status; notify?: (m: string) => void }) {
  const [mix, setMix] = useState(start);
  const refs = { mix };
  const player = new SetPlayer(() => refs.mix, () => {});
  return (
    <Mix
      status={state}
      mix={mix}
      mixName="Test mix"
      canUndo={false}
      refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)}
      refreshStatus={() => {}}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={notify}
      stage={false}
      toggleStage={() => {}}
    />
  );
}

describe('rendering every seam', () => {
  it('does not present remembered failures as ongoing renders', () => {
    render(<Harness start={songs(seam('failed', 'a', { error: 'No safe vocal runway.' }))} />);
    expect(screen.getByRole('button', { name: 'Change failed transitions to continue' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Render and hear' })).toBeNull();
    expect(screen.getByText(/Remembered failed attempt/)).toHaveTextContent('No safe vocal runway.');
    expect(screen.getByRole('button', { name: 'Retry this attempt anyway' })).toBeEnabled();
  });
  it('sends one request and every badge changes straight away', async () => {
    const calls = fakeBackend({
      'POST /mix/render': { mix: songs(seam('queued', 'a'), seam('queued', 'b')), name: 'Test mix', can_undo: false },
    });
    render(<Harness start={songs(seam('none', 'a'), seam('none', 'b'))} />);
    expect(screen.getAllByText('Waiting to render')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Render every seam' }));
    await waitFor(() => expect(calls.filter((call) => call.path === '/mix/render')).toHaveLength(1));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Rendering/ })).toBeDisabled();
  });
});

describe('a seam’s row', () => {
  it('offers no render button while the seam is under way, only its badge', () => {
    render(<Harness start={songs(seam('rendering', 'a'))} />);
    expect(screen.getByText('Rendering…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Render and hear' })).toBeNull();
  });

  it('offers listening and rating once ready', () => {
    render(<Harness start={songs(seam('ready', 'a', { duration: 30, a_source_start: 100, b_source_end: 10 }))} />);
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Rate this seam' })).getAllByRole('button')).toHaveLength(2);
  });
});

describe('the song adder', () => {
  const suggestion = (id: number, title: string, analysed = true) => ({
    song_id: id,
    artist: 'Someone',
    title,
    bpm: 120,
    key: '8A',
    duration: 200,
    reason: analysed ? 'Same tempo' : 'Needs analysing first',
    analysed,
  });

  it('shows recommendations first, then searches in order of what fits', async () => {
    const calls = fakeBackend({
      'GET /mix/suggest': (_body: unknown, url: string) =>
        url.includes('q=love')
          ? { songs: [suggestion(3, 'Love Song'), suggestion(4, 'Love Later', false)] }
          : { songs: [suggestion(1, 'Best Fit'), suggestion(2, 'Next Best')] },
    });
    const onAdd = vi.fn();
    render(<Adder position={1} onAdd={onAdd} onClose={() => {}} notify={() => {}} line={[]} refreshStatus={() => {}} />);
    expect(await screen.findByText('Best Fit')).toBeInTheDocument();
    expect(screen.getByText('These would fit best here')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'love');
    expect(await screen.findByText('Love Song')).toBeInTheDocument();
    expect(screen.getByText('Best fit first')).toBeInTheDocument();
    expect(calls.at(-1)?.path).toContain('q=love');
    await userEvent.click(screen.getByText('Love Song'));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ song_id: 3 }));
  });

  it('puts a song that isn’t ready in the analysis line and says where it is', async () => {
    const calls = fakeBackend({
      'GET /mix/suggest': { songs: [suggestion(4, 'Love Later', false)] },
      'POST /songs/4/analyse': { song_id: 4, ahead: 2, analysing: [8, 9, 4] },
    });
    const notify = vi.fn();
    const refreshStatus = vi.fn();
    render(<Adder position={1} onAdd={() => {}} onClose={() => {}} notify={notify} line={[]} refreshStatus={refreshStatus} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Analyse now' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Love Later is in line, with 2 ahead of it.'));
    expect(refreshStatus).toHaveBeenCalled();
    expect(calls.some((call) => call.path === '/songs/4/analyse')).toBe(true);
  });

  it('shows the place in line it’s given', async () => {
    fakeBackend({ 'GET /mix/suggest': { songs: [suggestion(4, 'Love Later', false)] } });
    render(<Adder position={1} onAdd={() => {}} onClose={() => {}} notify={() => {}} line={[8, 4]} refreshStatus={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Waiting, 1 ahead' })).toBeDisabled();
  });
});
