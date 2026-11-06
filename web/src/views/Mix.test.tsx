import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MixData, MixItem, Status } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Adder, Mix } from './Mix';
import { MixScope } from './mixScope';

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

describe('a draft on the Edit page', () => {
  function open(start: MixItem[], over: Record<string, unknown> = {}, routes: Record<string, unknown> = {}) {
    const calls = fakeBackend({ 'GET /drafts': { drafts: [], current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false }, ...routes });
    const props = { playDraft: vi.fn(async () => {}), openDraft: vi.fn(), closeDraft: vi.fn(), setView: vi.fn(), notify: vi.fn(), renamedDraft: vi.fn() };
    const player = new SetPlayer(() => [], () => {});
    render(
      <MixScope.Provider value={7}>
        <Mix
          status={status()}
          mix={start}
          mixName="Friday"
          canUndo={false}
          refreshMix={() => {}}
          setMixData={() => {}}
          refreshStatus={() => {}}
          player={player}
          now={player.state}
          stage={false}
          toggleStage={() => {}}
          draftPlace={null}
          {...props}
          {...over}
        />
      </MixScope.Provider>,
    );
    return { calls, ...props };
  }
  const waiting = () => songs(seam('none', 'a'), seam('none', 'b'));

  it('is plainly a draft, and says what’s playing isn’t affected', () => {
    open(waiting());
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText(/What’s playing isn’t affected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to current mix' })).toBeInTheDocument();
  });

  it('has no buttons that would change the current mix', () => {
    open(waiting());
    for (const name of ['Clear', 'New mix', 'Save a copy', 'Play from the top', 'Render every seam']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('plays through the draft, from the top or from any song', async () => {
    const { playDraft } = open(waiting());
    await userEvent.click(screen.getByRole('button', { name: 'Play this mix' }));
    expect(playDraft).toHaveBeenCalledWith(7);
    await userEvent.click(screen.getByRole('button', { name: 'Play from Song 2' }));
    expect(playDraft).toHaveBeenCalledWith(7, 1);
  });

  it('sends every change to the draft', async () => {
    const data = { mix: waiting(), name: 'Friday', can_undo: true };
    const { calls } = open(waiting(), {}, {
      'POST /mix/move': data,
      'POST /mix/1/lock': data,
      'DELETE /mix/songs/1': data,
      'POST /mix/1/render': {},
    });
    await userEvent.click(screen.getByRole('button', { name: 'Move Song 2 up' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Lock' })[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Song 2' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Render and hear' })[0]);
    await waitFor(() => expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(4));
    for (const call of calls.filter((item) => item.method !== 'GET')) expect(call.path).toContain('draft=7');
  });

  it('prioritizes, and quotes the wait', async () => {
    const answer = { drafts: [{ id: 7, place: 2, eta: { seconds: 600, low: 500, high: 700 } }], current: { name: 'Current', songs: 3, left: 1, eta: { seconds: 60, low: 40, high: 90 } }, out_of_room: false };
    const { calls, notify } = open(waiting(), { mixEta: { seconds: 300, low: 240, high: 360, seams: 2 } }, { 'POST /drafts/7/line': answer });
    expect(screen.getByText(/Prioritize it and all of it would be ready in about 5 minutes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Prioritize' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(calls.some((call) => call.path === '/drafts/7/line')).toBe(true);
    expect(notify.mock.calls[0][0]).toContain('about 10 minutes');
  });

  it('shows its place when it’s in line, and can come out', async () => {
    const answer = { drafts: [{ id: 7, place: null, eta: null }], current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false };
    const { calls } = open(waiting(), { draftPlace: 2, mixEta: { seconds: 600, low: 500, high: 700, seams: 2 } }, { 'DELETE /drafts/7/line': answer });
    expect(screen.getByText(/2nd in line\. All ready in about 10 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prioritize' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Take out of line' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
  });

  it('does not offer to prioritize a draft that is all rendered', () => {
    open(songs(seam('ready', 'a'), seam('ready', 'b')));
    expect(screen.queryByRole('button', { name: 'Prioritize' })).toBeNull();
  });

  it('renames in place', async () => {
    const { renamedDraft } = open(waiting(), {}, { 'POST /drafts/7/name': { id: 7, name: 'Sunday' } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name this draft' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Sunday{Enter}');
    await waitFor(() => expect(renamedDraft).toHaveBeenCalledWith('Sunday'));
  });

  it('deleting closes it, goes back to the list, and can be undone', async () => {
    const { closeDraft, setView, notify, openDraft } = open(waiting(), {}, {
      'DELETE /drafts/7': { name: 'Friday' },
      'POST /drafts/restore': { id: 7 },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(closeDraft).toHaveBeenCalled();
    expect(setView).toHaveBeenCalledWith('Mixes');
    await (notify.mock.calls[0][1] as () => Promise<void>)();
    expect(openDraft).toHaveBeenCalledWith(7);
  });

  it('an empty draft goes straight to choosing the first song', async () => {
    const { calls } = open([], {}, { 'GET /mix/suggest': { songs: [] } });
    expect(screen.getByText(/Add the first song/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.path.startsWith('/mix/suggest') && call.path.includes('draft=7'))).toBe(true));
    expect(screen.queryByRole('button', { name: 'See the mixes' })).toBeNull();
  });

  it('can switch to another mix without leaving the page', async () => {
    const list = { drafts: [{ id: 7, name: 'Friday' }, { id: 8, name: 'Sunday' }], current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false };
    const { openDraft, closeDraft } = open(waiting(), {}, { 'GET /drafts': list });
    const choose = await screen.findByRole('combobox');
    await userEvent.selectOptions(choose, '8');
    expect(openDraft).toHaveBeenCalledWith(8);
    await userEvent.selectOptions(choose, 'current');
    expect(closeDraft).toHaveBeenCalled();
  });
});

describe('the current mix and drafts', () => {
  it('keeps a copy as a draft, leaving the mix as it is', async () => {
    const calls = fakeBackend({ 'POST /drafts': { id: 3, name: 'Test mix' } });
    const notify = vi.fn();
    render(<Harness start={songs(seam('ready', 'a'))} notify={notify} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save a copy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save copy' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(calls.find((call) => call.path === '/drafts' && call.method === 'POST')?.body).toEqual({ name: 'Test mix', copy_current: true });
    expect(notify.mock.calls[0][0]).toContain('Saved a copy as a draft');
  });

  it('does not show a switcher until there is something to switch to', async () => {
    const calls = fakeBackend({ 'GET /drafts': { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false } });
    render(<Harness start={songs(seam('ready', 'a'))} />);
    await waitFor(() => expect(calls.some((call) => call.path === '/drafts')).toBe(true));
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
