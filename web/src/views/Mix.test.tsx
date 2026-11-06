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

describe('the options for a seam', () => {
  const options = {
    moves: [
      { name: 'auto', label: 'Let Selecta choose', description: '', available: true, reason: null, blends: false, rides: false, uses_cues: false, uses_phrase: false },
      { name: 'vocal_ride', label: 'Vocal ride', description: '', available: true, reason: null, blends: true, rides: true, uses_cues: true, uses_phrase: false },
      { name: 'delay_throw', label: 'Delay throw', description: '', available: true, reason: null, blends: false, rides: false, uses_cues: true, uses_phrase: false },
    ],
    exits: [],
    entries: [],
    lengths: [],
    links: [],
    studio: { available: false, reason: 'These two are 30% apart in tempo.' },
    tempo_gap: 2,
    keys: ['8A', '9A'],
  };
  const landed = (style: string, status: 'ready' | 'rendering' = 'ready') => ({
    settings: { move: 'vocal_ride' },
    state: { status, key: 'a', passed: true, style, label: 'Delay throw', fell_back: true, tried: [] },
  });
  const openSeam = async (start: MixItem[]) => {
    fakeBackend({ 'GET /mix/1/options': options });
    render(<Harness start={start} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    return screen.findByRole('group', { name: 'How should this land?' });
  };

  it('highlights the move you are actually hearing, even when another was planned', async () => {
    const group = await openSeam(songs(landed('delay_throw')));
    expect(within(group).getByRole('button', { name: /Delay throw/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /Vocal ride/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('highlights the plan until something has landed', async () => {
    const group = await openSeam(songs(landed('delay_throw', 'rendering')));
    expect(within(group).getByRole('button', { name: /Vocal ride/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /Delay throw/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says why the stems can’t be shaped, instead of a button that fails', async () => {
    await openSeam(songs(landed('delay_throw')));
    expect(screen.getByRole('button', { name: 'Shape it yourself with stems' })).toBeDisabled();
    expect(screen.getByText(/30% apart/)).toBeInTheDocument();
  });

  it('opens the studio when the stems can be shaped', async () => {
    const calls = fakeBackend({
      'GET /mix/1/options': { ...options, studio: { available: true, reason: null } },
      'POST /mix/1/studio': { status: 'queued', key: 'k', eta: { seconds: 60, low: 40, high: 90 } },
    });
    render(<Harness start={songs(landed('delay_throw'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Shape it yourself with stems' }));
    expect(await screen.findByRole('region', { name: 'Stem studio' })).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/mix/1/studio')).toBe(true);
  });
});

describe('how long the mix will take', () => {
  const data = (over: Record<string, unknown>) => (
    <Mix
      status={status()}
      mix={songs(seam('none', 'a'), seam('none', 'b'))}
      mixName="Test mix"
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={new SetPlayer(() => [], () => {})}
      now={new SetPlayer(() => [], () => {}).state}
      setView={() => {}}
      notify={() => {}}
      stage={false}
      toggleStage={() => {}}
      {...over}
    />
  );

  it('says how long what is left will take', () => {
    render(data({ mixEta: { seconds: 300, low: 240, high: 360, seams: 2 } }));
    expect(screen.getByText(/The rest take about 5 minutes/)).toBeInTheDocument();
  });

  it('says nothing about time when it is all rendered', () => {
    render(data({ mixEta: { seconds: 0, low: 0, high: 0, seams: 0 } }));
    expect(screen.queryByText(/The rest take/)).toBeNull();
  });

  it('shows when each waiting seam should be ready', () => {
    const waiting = songs(seam('queued', 'a', { eta: 40 }), seam('queued', 'b', { eta: 200 }));
    render(data({ mix: waiting }));
    expect(screen.getByText(/under a minute/)).toBeInTheDocument();
    expect(screen.getByText(/about 3 minutes/)).toBeInTheDocument();
  });
});
