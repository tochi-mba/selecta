import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportJob, MixData, MixItem, Status } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, seam, songs, status } from '../test/backend';
import { Adder } from './Adder';
import { refreshExports, resetExports } from './exportStore';
import { ExportPanel } from './ExportPanel';
import { SeamInspector } from './SeamInspector';
import { Mix } from './Mix';
import { MixScope } from './mixScope';
import { RequestsContext, RequestsState } from './Requests';

function Harness({ start, state = status(), notify = () => {}, refreshMix = () => {} }: { start: MixItem[]; state?: Status; notify?: (m: string) => void; refreshMix?: () => void }) {
  const [mix, setMix] = useState(start);
  const refs = { mix };
  const player = new SetPlayer(() => refs.mix, () => {});
  return (
    <Mix
      status={state}
      mix={mix}
      mixName="Test mix"
      canUndo={false}
      refreshMix={refreshMix}
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
    expect(screen.queryByRole('button', { name: 'Render it' })).toBeNull();
    expect(screen.getByText(/Remembered failed attempt/)).toHaveTextContent('No safe vocal runway.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
  it('sends one request and every badge changes straight away', async () => {
    const calls = fakeBackend({
      'POST /mix/render': { mix: songs(seam('queued', 'a'), seam('queued', 'b')), name: 'Test mix', can_undo: false },
    });
    render(<Harness start={songs(seam('none', 'a'), seam('none', 'b'))} />);
    expect(screen.getAllByText('Not rendered yet')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Render every transition' }));
    await waitFor(() => expect(calls.filter((call) => call.path === '/mix/render')).toHaveLength(1));
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Rendering/ })).toBeDisabled();
  });
});

describe('blocked transition timing', () => {
  it('blocks export until the invalid transition is fixed', async () => {
    render(<Harness start={songs({ ...seam('ready', 'a'), too_soon: true })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download audio' }));
    expect(screen.getByText(/Adjust the transition timing in the editor before exporting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save it' })).toBeDisabled();
  });

  it('does not offer to render a cut-off transition', () => {
    render(<Harness start={songs({ ...seam('none', 'a'), too_soon: true })} />);
    expect(screen.getByRole('button', { name: 'Fix transition timing to continue' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Render every transition' })).toBeNull();
  });
});

describe('exact song identity under metadata stress', () => {
  it('keeps duplicate, RTL and CJK song names readable and occurrence-scoped', () => {
    const mix = songs(seam('ready', 'a'));
    const title = 'رحلة ليلية - ' + 'Very long title '.repeat(8);
    mix[0].title = title;
    mix[1].title = title;
    mix[0].artist = '東京の音楽';
    mix[1].artist = '東京の音楽';
    render(<Harness start={mix} />);

    const rows = [...document.querySelectorAll<HTMLElement>('.timeline .song')];
    expect(rows).toHaveLength(2);
    rows.forEach((row, index) => {
      const selection = row.querySelector<HTMLButtonElement>('.song-select');
      const reorder = row.querySelector<HTMLElement>('.grip');
      expect(selection).toHaveAttribute('aria-description', `Song occurrence ${index + 1} of 2`);
      expect(reorder).toHaveAttribute('aria-description', `Song occurrence ${index + 1} of 2`);
      expect(selection?.querySelector('b')).toHaveAttribute('dir', 'auto');
      expect(selection?.querySelector('b')).toHaveAttribute('title', title);
      expect(row.querySelector('.song-name > span')).toHaveAttribute('dir', 'auto');
    });
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
      { name: 'auto', label: 'Let SelectaDJ choose', description: '', available: true, reason: null, blends: false, rides: false, uses_cues: false, uses_phrase: false },
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

  it('keeps the move you asked for pressed, and names what really plays separately', async () => {
    const group = await openSeam(songs(landed('delay_throw')));
    expect(within(group).getByRole('button', { name: /Vocal ride/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /Delay throw/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/You asked for Vocal ride\. Delay throw will play instead/)).toBeInTheDocument();
    expect(screen.getByText(/Your choice stays as it is until you change it/)).toBeInTheDocument();
  });

  it('says nothing about a fallback when what played is what was asked for', async () => {
    const group = await openSeam(songs({ settings: { move: 'vocal_ride' }, state: { status: 'ready', key: 'a', passed: true, style: 'vocal_ride', label: 'Vocal ride' } }));
    expect(within(group).getByRole('button', { name: /Vocal ride/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/will play instead/)).toBeNull();
  });

  it('highlights the plan until something has landed', async () => {
    const group = await openSeam(songs(landed('delay_throw', 'rendering')));
    expect(within(group).getByRole('button', { name: /Vocal ride/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /Delay throw/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says why the stems can’t be shaped, instead of a button that fails', async () => {
    await openSeam(songs(landed('delay_throw')));
    await userEvent.click(screen.getByRole('tab', { name: 'Studio' }));
    expect(await screen.findByText(/30% apart/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the Studio' })).toBeNull();
  });

  it('opens the studio when the stems can be shaped', async () => {
    const calls = fakeBackend({
      'GET /mix/1/options': { ...options, studio: { available: true, reason: null } },
      'POST /mix/1/studio': { status: 'queued', key: 'k', eta: { seconds: 60, low: 40, high: 90 } },
    });
    render(<Harness start={songs(landed('delay_throw'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    await userEvent.click(await screen.findByRole('tab', { name: 'Studio' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open the Studio' }));
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
    expect(screen.getByText('Editing a draft')).toBeInTheDocument();
    expect(screen.getByText(/What’s playing isn’t affected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to current mix' })).toBeInTheDocument();
  });

  it('has no buttons that would change the current mix', () => {
    open(waiting());
    for (const name of ['Clear', 'New mix', 'Save a copy', 'Play from the top', 'Render every transition']) {
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
    await userEvent.click(screen.getByRole('button', { name: 'More for Song 2' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Lock' }));
    await userEvent.click(screen.getByRole('button', { name: 'More for Song 2' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Song 2' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Render it' })[0]);
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
    expect(screen.getByRole('dialog', { name: 'Delete Friday?' })).toBeInTheDocument();
    expect(notify).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep this draft' }));
    expect(notify).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
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
  it('keeps each mix scope’s exact selection separate when the mounted editor switches scope', async () => {
    const start = songs(seam('ready', 'a'));
    function ScopeHarness() {
      const [scope, setScope] = useState<number | null>(null);
      const player = useRef(new SetPlayer(() => start, () => {})).current;
      return (
        <>
          <button onClick={() => setScope((value) => value === null ? 7 : null)}>Switch scope</button>
          <MixScope.Provider value={scope}>
            <Mix
              status={status()}
              mix={start}
              mixName={scope === null ? 'Current' : 'Draft'}
              canUndo={false}
              refreshMix={() => {}}
              setMixData={() => {}}
              refreshStatus={() => {}}
              player={player}
              now={player.state}
              setView={() => {}}
              notify={() => {}}
              stage={false}
              toggleStage={() => {}}
              draftPlace={null}
              playDraft={async () => {}}
            />
          </MixScope.Provider>
        </>
      );
    }

    render(<ScopeHarness />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Song 1' })[0]);
    expect(screen.getByRole('complementary', { name: 'This song' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Switch scope' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'This song' })).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Switch scope' }));
    expect(await screen.findByRole('complementary', { name: 'This song' })).toBeInTheDocument();
  });

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

describe('songs a request added', () => {
  const added = () => {
    const mix = songs(seam('ready', 'a'), seam('ready', 'b'));
    mix[1].from_request = { kind: 'requested' };
    mix[2].from_request = { kind: 'bridge', for: 'Song 2' };
    return mix;
  };

  it('stand out in the mix, and say why they’re there', () => {
    render(<Harness start={added()} />);
    const requested = screen.getByText('Requested').closest('li');
    expect(requested).toHaveClass('requested');
    expect(requested).toHaveTextContent('Song 2');
    expect(screen.getByText('Bridge to Song 2').closest('li')).toHaveClass('requested');
  });

  it('other songs look as they always have', () => {
    const { container } = render(<Harness start={added()} />);
    expect(container.querySelectorAll('li.song')).toHaveLength(3);
    expect(container.querySelectorAll('li.song.requested')).toHaveLength(2);
    expect(container.querySelector('li.song')).not.toHaveClass('requested');
  });
});

describe('requests on the Edit page', () => {
  const state = (requests: unknown[] = []) => ({
    requests, error: '', message: '',
    add: async () => {}, cancel: async () => {}, chooseBridge: async () => {}, addAnyway: async () => {},
  }) as unknown as RequestsState;

  it('show up faded in the timeline at the place they’re going', () => {
    const start = songs(seam('ready', 'a'), seam('ready', 'b'));
    const player = new SetPlayer(() => [], () => {});
    (player as unknown as { state: { phase: string } }).state.phase = 'playing';
    const coming = { id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, stage: 'preparing', after_id: 2 };
    const { container } = render(
      <RequestsContext.Provider value={{ ...state([coming]), playback: { mix: start, player, onMix: () => {} } }}>
        <Harness start={start} />
      </RequestsContext.Provider>,
    );
    const rows = [...container.querySelectorAll('ol.timeline li.song')].map((row) => row.querySelector('b')?.textContent);
    expect(rows).toEqual(['Song 1', 'Song 2', 'Wanted', 'Song 3']);
    expect(container.querySelector('li.song.coming')).toHaveTextContent('Wanted');
  });

  it('take over from the transition they’ll replace, which comes back if they’re cancelled', () => {
    const start = songs(seam('ready', 'a'), seam('ready', 'b'));
    const player = new SetPlayer(() => [], () => {});
    (player as unknown as { state: { phase: string } }).state.phase = 'playing';
    const coming = { id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, stage: 'preparing', after_id: 2 };
    const playback = { mix: start, player, onMix: () => {} };
    const { container, rerender } = render(
      <RequestsContext.Provider value={{ ...state([coming]), playback }}><Harness start={start} /></RequestsContext.Provider>,
    );
    expect(container.querySelectorAll('ol.timeline > li.seam')).toHaveLength(1);
    rerender(<RequestsContext.Provider value={{ ...state([]), playback }}><Harness start={start} /></RequestsContext.Provider>);
    expect(container.querySelectorAll('ol.timeline > li.seam')).toHaveLength(2);
  });

  it('aren’t shown on a draft, since requests only join what’s playing', () => {
    fakeBackend({});
    const player = new SetPlayer(() => [], () => {});
    render(
      <RequestsContext.Provider value={state()}>
        <MixScope.Provider value={7}>
          <Mix
            status={status()} mix={songs(seam('none', 'a'))} mixName="Friday" canUndo={false}
            refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
            player={player} now={player.state} setView={() => {}} notify={() => {}}
            stage={false} toggleStage={() => {}} draftPlace={null}
          />
        </MixScope.Provider>
      </RequestsContext.Provider>,
    );
    expect(screen.queryByRole('region', { name: 'Song requests' })).toBeNull();
  });
});

describe('what’s selected', () => {
  const ready = () => seam('ready', 'a', { label: 'Blend', style: 'bass_swap_blend', why: 'Close in tempo', a_source_start: 60, b_source_end: 30, preview_seam: 20, checks: [{ name: 'beat', passed: true, text: 'The beats line up', value: '' }] });
  const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };
  const pick = async () => {
    fakeBackend({ 'GET /mix/1/options': options });
    render(<Harness start={songs(ready())} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
  };

  it('opens beside the timeline, for the two songs it’s between', async () => {
    await pick();
    const side = screen.getByRole('complementary', { name: 'This transition' });
    expect(within(side).getByText('Song 1')).toBeInTheDocument();
    expect(within(side).getByText('Song 2')).toBeInTheDocument();
    expect(within(side).getByRole('tab', { name: 'Listen' })).toHaveAttribute('aria-selected', 'true');
  });

  it('smoothly resets the inspector when a transition is opened', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
    await pick();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' }));
  });

  it('plays the exact render, and the same stays selected when others move', async () => {
    await pick();
    const side = screen.getByRole('complementary', { name: 'This transition' });
    expect(side.querySelector('audio')).toHaveAttribute('src', '/api/seams/a/preview');
  });

  it('has everything about it a tab away', async () => {
    await pick();
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByText('Close in tempo.')).toBeInTheDocument();
    expect(screen.getByText('The beats line up').closest('li')).toHaveClass('ok');
    expect(screen.getByText(/Leaves Song 1 at 1:00/)).toBeInTheDocument();
    expect(screen.getByText(/can’t tell you how it sounds/)).toBeInTheDocument();
  });

  it('closes when told to', async () => {
    await pick();
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('says what you chose and what will really play, if they differ', async () => {
    const swapped = { settings: { move: 'vocal_ride' }, state: { status: 'ready' as const, key: 'a', passed: true, label: 'Blend', style: 'bass_swap_blend', fell_back: true } };
    fakeBackend({ 'GET /mix/1/options': options });
    render(<Harness start={songs(swapped)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByText(/What will play is Blend/)).toBeInTheDocument();
  });

  it('says when it’s been held back to give the song a turn', async () => {
    const held = { settings: { move: 'auto', leave_after: 90 }, state: { status: 'ready' as const, key: 'a', passed: true, label: 'Blend', a_source_start: 95, b_source_end: 30 } };
    fakeBackend({ 'GET /mix/1/options': options });
    render(<Harness start={songs(held as never)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByText(/Held back to leave Song 1 after 1:30/)).toBeInTheDocument();
  });
});

describe('transition edit intent', () => {
  it('keeps the latest choice visible when an older server response refreshes the inspector', async () => {
    const moves = [
      { name: 'bass_swap_blend', label: 'Blend', description: 'Blend smoothly', available: true },
      { name: 'cut_on_one', label: 'Cut', description: 'Cut on the beat', available: true },
    ];
    // the write is still on its way when an older answer about the mix arrives
    let landed: (answer: Response) => void = () => {};
    fakeBackend({ 'GET /mix/1/options': { moves, exits: [], entries: [], lengths: [], links: [], tempo_gap: 0, keys: ['8A', '8A'] } });
    const answers = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (
      url.includes('/mix/1/seam') ? new Promise<Response>((done) => { landed = done; }) : answers(url, init)
    )));
    const [previous, original] = songs(seam('ready', 'a'));
    const props = (item: MixItem) => (
      <SeamInspector
        item={item}
        previous={previous}
        names={{ bass_swap_blend: 'Blend', cut_on_one: 'Cut' }}
        refreshMix={() => {}}
        notify={() => {}}
        guard={{ 'x-mix-order': '1,2' }}
        tab="change"
        setTab={() => {}}
        autoPlay={false}
        onClose={() => {}}
      />
    );
    const rendered = render(props(original));
    const cut = await screen.findByRole('button', { name: 'Cut' });
    fireEvent.click(cut);
    await waitFor(() => expect(cut).toHaveAttribute('aria-pressed', 'true'));
    // An unrelated or older server-side settings snapshot can arrive after selection.
    // It cannot reset the fresh local choice before the actual matching write returns.
    rendered.rerender(props({
      ...original,
      seam: { ...original.seam!, settings: { move: 'auto' } },
    }));
    expect(screen.getByRole('button', { name: 'Cut' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { landed(new Response(JSON.stringify({}), { status: 200 })); });
  });
});

describe('transition edit intent, once the server has it', () => {
  const moves = [
    { name: 'bass_swap_blend', label: 'Blend', description: 'Blend smoothly', available: true },
    { name: 'cut_on_one', label: 'Cut', description: 'Cut on the beat', available: true },
  ];
  const props = (item: MixItem, previous: MixItem) => (
    <SeamInspector
      item={item}
      previous={previous}
      names={{ bass_swap_blend: 'Blend', cut_on_one: 'Cut' }}
      refreshMix={() => {}}
      notify={() => {}}
      guard={{ 'x-mix-order': '1,2' }}
      tab="change"
      setTab={() => {}}
      autoPlay={false}
      onClose={() => {}}
    />
  );

  it('follows the server again, so an Undo shows what’s really there', async () => {
    fakeBackend({
      'GET /mix/1/options': { moves, exits: [], entries: [], lengths: [], links: [], tempo_gap: 0, keys: ['8A', '8A'] },
      'POST /mix/1/seam': {},
      'POST /mix/1/render': {},
    });
    const [previous, original] = songs(seam('ready', 'a'));
    const rendered = render(props(original, previous));
    await userEvent.click(await screen.findByRole('button', { name: 'Cut' }));
    // what the server really keeps: the choice, whose it was, and things it worked out itself
    rendered.rerender(props({ ...original, seam: { ...original.seam!, settings: { move: 'cut_on_one', soft: false, leave_after: 42 } as never } }, previous));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cut' })).toHaveAttribute('aria-pressed', 'true'));
    // then the change is undone, from the keyboard or another tab
    rendered.rerender(props({ ...original, seam: { ...original.seam!, settings: { move: 'bass_swap_blend' } } }, previous));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Blend' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Cut' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lets go of a choice that changed nothing on the server', async () => {
    fakeBackend({
      'GET /mix/1/options': { moves, exits: [], entries: [], lengths: [], links: [], tempo_gap: 0, keys: ['8A', '8A'] },
      'POST /mix/1/seam': {},
      'POST /mix/1/render': {},
    });
    const [previous, original] = songs(seam('ready', 'a'));
    const already = { ...original, seam: { ...original.seam!, settings: { move: 'cut_on_one', soft: false } as never } };
    const rendered = render(props(already, previous));
    await userEvent.click(await screen.findByRole('button', { name: 'Cut' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cut' })).not.toHaveAttribute('aria-busy'));
    rendered.rerender(props({ ...original, seam: { ...original.seam!, settings: { move: 'bass_swap_blend' } } }, previous));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Blend' })).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('changes that could hit the wrong song', () => {
  it('say which order they saw', async () => {
    const answer = { mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: true };
    const seen: (string | null)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/drafts')) return new Response(JSON.stringify({ drafts: [] }), { status: 200 });
      seen.push(new Headers(init?.headers).get('x-mix-order'));
      return new Response(JSON.stringify(answer), { status: 200 });
    }));
    render(<Harness start={songs(seam('ready', 'a'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'More for Song 2' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Song 2' }));
    await waitFor(() => expect(seen).toContain('1,2'));
  });

  it('stop and catch up if the mix has moved on', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/drafts')
      ? new Response(JSON.stringify({ drafts: [] }), { status: 200 })
      : new Response(JSON.stringify({ detail: 'This mix has just changed, so nothing was done.', code: 'mix_changed' }), { status: 409 }))));
    const refreshMix = vi.fn();
    render(<Harness start={songs(seam('ready', 'a'))} refreshMix={refreshMix} />);
    await userEvent.click(screen.getByRole('button', { name: 'More for Song 2' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove Song 2' }));
    await waitFor(() => expect(refreshMix).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'More for Song 2' }));
    expect(screen.getByRole('menuitem', { name: 'Remove Song 2' })).toBeInTheDocument();
  });
});

describe('saving as a file', () => {
  const open = async (start = songs(seam('ready', 'a'))) => {
    render(<Harness start={start} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download audio' }));
  };
  const exportJob = (more: Partial<ExportJob> = {}): ExportJob => ({
    id: 'job-1',
    state: 'preparing',
    scope: 'current',
    draft: null,
    mix_name: 'Test mix',
    revision: 'a1b2c3d4e5f6',
    songs: [{ song_id: 1, title: 'Song 1', artist: 'Artist 1' }, { song_id: 2, title: 'Song 2', artist: 'Artist 2' }],
    seams: [{ key: 'a', from: 'Song 1', to: 'Song 2' }],
    seams_total: 1,
    seams_ready: 0,
    seconds_estimate: 400,
    name: 'mix.flac',
    seconds: null,
    error: null,
    created_at: 1700000000,
    can_cancel: true,
    quiet_seconds: 0,
    ...more,
  });

  beforeEach(() => resetExports());

  it('does not carry an in-flight export across a change of editing scope', async () => {
    fakeBackend({
      'GET /exports/jobs': { jobs: [] },
      'POST /exports/jobs': exportJob(),
    });
    const props = { mix: songs(seam('ready', 'a')), mixName: 'Same songs', guard: {}, setMixData: () => {}, names: {}, onClose: () => {} };
    const rendered = render(
      <MixScope.Provider value={null}><ExportPanel {...props} inDraft={false} /></MixScope.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }));
    expect(await screen.findByText(/Prepare transitions - 0 of 1 ready/)).toBeInTheDocument();
    expect(screen.getByText(/Frozen revision/)).toHaveTextContent('a1b2c3d4e5f6');
    rendered.rerender(
      <MixScope.Provider value={9}><ExportPanel {...props} inDraft /></MixScope.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Save it' })).toBeEnabled();
    expect(screen.queryByText(/Prepare transitions - 0 of 1 ready/)).toBeNull();
  });

  it('never confuses two different drafts with identical songs and transition keys', async () => {
    fakeBackend({
      'GET /exports/jobs': { jobs: [exportJob({ scope: 'draft', draft: 101, state: 'ready', can_cancel: false, seams_ready: 1 })] },
    });
    await refreshExports();
    render(
      <MixScope.Provider value={202}>
        <ExportPanel
          mix={songs(seam('ready', 'a'))}
          mixName="Second draft"
          inDraft
          guard={{}}
          setMixData={() => {}}
          names={{}}
          onClose={() => {}}
        />
      </MixScope.Provider>,
    );
    expect(screen.getByRole('dialog', { name: 'Save as an audio file' })).toHaveTextContent('Second draft');
    expect(screen.queryByRole('link', { name: 'download mix.flac' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save it' })).toBeEnabled();
  });

  it('says exactly which mix, and what it’s waiting on', async () => {
    fakeBackend({ 'GET /exports/jobs': { jobs: [] } });
    await open(songs(seam('ready', 'a'), seam('none', 'b')));
    expect(screen.getByRole('dialog', { name: 'Save as an audio file' })).toHaveTextContent('Test mix');
    expect(screen.getByText(/1 of 2 transitions ready/)).toBeInTheDocument();
    expect(screen.getByText(/Into Song 3/)).toBeInTheDocument();
    expect(screen.getByText(/original songs aren’t touched/)).toBeInTheDocument();
  });

  it('only offers the file once it really exists', async () => {
    let jobs: ExportJob[] = [];
    const calls = fakeBackend({
      'GET /exports/jobs': () => ({ jobs }),
      'POST /exports/jobs': () => {
        const started = exportJob();
        jobs = [started];
        return started;
      },
    });
    await open();
    expect(screen.queryByRole('link', { name: /download/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }));
    expect(await screen.findByText(/Prepare transitions - 0 of 1 ready/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/ })).toBeNull();
    jobs = [exportJob({ state: 'encoding', seams_ready: 1, can_cancel: false })];
    expect(await screen.findByRole('button', { name: 'Saving the file…' }, { timeout: 3000 })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /download/ })).toBeNull();
    jobs = [exportJob({ state: 'ready', seams_ready: 1, seconds: 300, can_cancel: false })];
    expect(await screen.findByRole('link', { name: 'download mix.flac' }, { timeout: 3000 })).toHaveAttribute('href', '/api/exports/mix.flac');
    expect(calls.filter((call) => call.method === 'POST' && call.path === '/exports/jobs')).toHaveLength(1);
    expect(calls.some((call) => call.path === '/mix/export')).toBe(false);
  });

  it('says so if what’s left can’t be made', async () => {
    const stuck = songs(seam('failed', 'a', { error: 'No.' }));
    let jobs: ExportJob[] = [];
    fakeBackend({
      'GET /exports/jobs': () => ({ jobs }),
      'POST /exports/jobs': () => {
        const started = exportJob();
        jobs = [exportJob({ state: 'failed', can_cancel: false, error: 'The transition from Song 1 into Song 2 couldn’t be made: No. Choose another move for it, then export again.' })];
        return started;
      },
    });
    await open(stuck);
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }));
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('couldn’t be made');
    expect(screen.queryByRole('link', { name: /download/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save it' })).toBeEnabled();
  });
});

describe('timeline drop safety', () => {
  it('ignores outside text drops instead of treating blank text as song zero', () => {
    const calls = fakeBackend({});
    render(<Harness start={songs(seam('none', 'a'))} />);
    const target = screen.getByRole('button', { name: 'Reorder Song 2' }).closest('li')!;
    const outside = { types: ['text/plain'], getData: () => '' };
    fireEvent.dragOver(target, { dataTransfer: outside });
    fireEvent.drop(target, { dataTransfer: outside });
    expect(calls.some((call) => call.path === '/mix/move')).toBe(false);
  });
});

describe('complete FLAC snapshot inspection', () => {
  it('shows the exact ordered source songs before creating a file', async () => {
    resetExports();
    fakeBackend({ 'GET /exports/jobs': { jobs: [] } });
    render(
      <MixScope.Provider value={null}>
        <ExportPanel mix={songs(seam('ready', 'a'))} mixName="My mix" inDraft={false}
          guard={{}} setMixData={() => {}} names={{}} onClose={() => {}} />
      </MixScope.Provider>,
    );
    fireEvent.click(screen.getByText(/Review proposed order/));
    const snapshot = screen.getByText(/Review proposed order/).closest('details')!;
    expect(within(snapshot).getByText('Song 1')).toBeInTheDocument();
    expect(within(snapshot).getByText('Song 2')).toBeInTheDocument();
    expect(snapshot).toHaveTextContent('not a finished file yet');
  });
});

// S3-0058-07: a rating names the exact seam it is about, and comes back from the server after leaving
describe('rating a transition', () => {
  const rated = (rating: string) => seam('ready', 'seam-k1', { label: 'Blend', style: 'bass_swap_blend', a_source_start: 60, b_source_end: 30, preview_seam: 20, rating } as never);
  const options = { moves: [], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };

  it('posts to that seam alone, and shows the saved rating again after a remount', async () => {
    const calls = fakeBackend({ 'GET /mix/1/options': options, 'POST /seams/seam-k1/rate': {} });
    const refreshMix = vi.fn();
    const first = render(<Harness start={songs(rated('good'))} refreshMix={refreshMix} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    const thumbs = within(within(screen.getByRole('complementary', { name: 'This transition' })).getByRole('group', { name: 'Rate this seam' }));
    expect(thumbs.getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(thumbs.getByRole('button', { name: 'Bad' }));
    await waitFor(() => expect(refreshMix).toHaveBeenCalled());
    expect(calls.filter((call) => call.method === 'POST').map((call) => [call.path, call.body])).toEqual([['/seams/seam-k1/rate', { rating: 'bad' }]]);
    first.unmount();
    render(<Harness start={songs(rated('bad'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    const side = within(screen.getByRole('complementary', { name: 'This transition' }));
    expect(within(side.getByRole('group', { name: 'Rate this seam' })).getByRole('button', { name: 'Bad' })).toHaveAttribute('aria-pressed', 'true');
  });
});

// S3-0058-03 and -09: an exact cue the server refuses is marked invalid on the control, with the reason
describe('an exact cue that cannot be used', () => {
  it('marks both cue fields invalid, says why, and keeps the server’s choice', async () => {
    const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [{ bar: 32, time: 64, kind: 'phrase' }], entries: [{ bar: 8, time: 16, kind: 'phrase' }], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };
    fakeBackend({ 'GET /mix/1/options': options, 'POST /mix/1/seam': new Reply(422, { detail: 'That cue is too late for this pair.' }) });
    render(<Harness start={songs(seam('ready', 'a', { label: 'Blend', style: 'bass_swap_blend', a_source_start: 60, b_source_end: 30, preview_seam: 20 }))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Change' }));
    const leave = await screen.findByLabelText(/Leave .* at/);
    expect(leave).not.toHaveAttribute('aria-invalid');
    fireEvent.change(leave, { target: { value: '32' } });
    await waitFor(() => expect(leave).toHaveAttribute('aria-invalid', 'true'));
    const reason = document.getElementById(leave.getAttribute('aria-describedby')!);
    expect(reason).toHaveTextContent('That cue is too late for this pair.');
    expect(leave).toHaveValue('');
  });
});

// S3-0057-05: Jump to first problem opens the failed transition itself, ready to change
describe('jumping to a problem', () => {
  it('opens the first transition that failed, on Change, and names that pair', async () => {
    const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };
    fakeBackend({ 'GET /mix/1/options': options, 'GET /mix/2/options': options });
    render(<Harness start={songs(seam('ready', 'a', { a_source_start: 60, b_source_end: 30 }), seam('failed', 'b', { error: 'No safe vocal runway.' }))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Jump to first problem' }));
    const side = within(await screen.findByRole('complementary', { name: 'This transition' }));
    expect(side.getByText('Transition 2')).toBeInTheDocument();
    expect(document.querySelector('.inspector-pair')).toHaveTextContent(/Song 2 .*into Song 3/);
    expect(side.getByRole('tab', { name: 'Change' })).toHaveAttribute('aria-selected', 'true');
  });
});
