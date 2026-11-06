import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Mixes } from './Mixes';

const card = (key: string, name: string, group: string, more: Partial<VibeCard> = {}): VibeCard => ({
  key,
  name,
  group,
  blurb: `${name} words`,
  songs: 40,
  ready: true,
  needs: 0,
  artists: ['Someone', 'Someone Else'],
  tempo: [100, 124],
  moves: 'Vocal rides and long blends',
  seconds: 3900,
  ...more,
});

function show(energyArc: number[] | null = null) {
  const player = new SetPlayer(() => [], () => {});
  const initialStatus = status();
  render(
    <Mixes
      status={{
        ...initialStatus,
        steering: { ...initialStatus.steering, energy_arc: energyArc },
      }}
      mix={[]}
      mixName=""
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
    />,
  );
}

describe('Pick a feeling', () => {
  it('does not misreport zero mix-ready songs when an older server omits that count', async () => {
    fakeBackend({ 'GET /vibes': [] });
    const oldServerStatus = status();
    const counts = { ...oldServerStatus.counts };
    delete counts.ready;
    const player = new SetPlayer(() => [], () => {});
    render(
      <Mixes
        status={{ ...oldServerStatus, counts }}
        mix={[]}
        mixName=""
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
      />,
    );
    expect(
      await screen.findByText(/hasn’t reported how many songs have the cues needed for mixes/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 of 90 songs have the vocal or instrumental cues needed/)).not.toBeInTheDocument();
  });

  it('waits for six mix-ready songs even when audio analysis has finished on more', async () => {
    fakeBackend({ 'GET /vibes': [] });
    const player = new SetPlayer(() => [], () => {});
    render(
      <Mixes
        status={status({ counts: { ...status().counts, analysed: 20, ready: 2 } })}
        mix={[]}
        mixName=""
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
      />,
    );
    expect(await screen.findByText(/2 of 90 songs have the vocal or instrumental cues needed/)).toBeInTheDocument();
  });

  it('lets the listener choose the transition feel and saves it for future mixes', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { mix_language: 'seamless' },
    });
    show();
    const select = await screen.findByLabelText('Transition feel');
    fireEvent.change(select, { target: { value: 'seamless' } });
    expect(await screen.findByRole('combobox', { name: 'Transition feel' })).toHaveValue('seamless');
    expect(calls.some((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { value?: string }).value === 'seamless')).toBe(true);
  });

  it('lets the listener set how often new mixes use stem-assisted moves', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { mix_language: 'balanced', stems: 'often', target: null },
    });
    show();
    fireEvent.change(await screen.findByLabelText('Stem-assisted moves'), { target: { value: 'often' } });
    expect(await screen.findByLabelText('Stem-assisted moves')).toHaveValue('often');
    expect(calls.some((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { action?: string; value?: string }).action === 'stems' && (call.body as { value?: string }).value === 'often')).toBe(true);
  });

  it('lets the listener shape and save a five-stop energy arc', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { energy_arc: [62, 72, 35, 85, 68] },
    });
    show();
    const middle = await screen.findByRole('slider', { name: 'Energy arc middle' });
    fireEvent.change(middle, { target: { value: '35' } });
    expect(middle).toHaveValue('35');
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path === '/steer' &&
            (call.body as { action?: string; value?: number[] }).action === 'energy_arc' &&
            JSON.stringify((call.body as { value?: number[] }).value) ===
              JSON.stringify([62, 72, 35, 85, 68]),
        ),
      ).toBe(true);
    });
    const drawing = screen.getByRole('img', { name: 'Draw energy arc' });
    Object.defineProperty(drawing, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    });
    fireEvent.pointerDown(drawing, { clientX: 50, clientY: 4, pointerId: 1 });
    expect(middle).toHaveValue('100');
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path === '/steer' &&
            JSON.stringify((call.body as { value?: number[] }).value) ===
              JSON.stringify([62, 72, 100, 85, 68]),
        ),
      ).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Use each mix’s arc' })).toBeEnabled();
  });

  it('clears a saved energy arc back to the mix-specific default', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { energy_arc: null },
    });
    show([20, 40, 80, 60, 30]);
    fireEvent.click(await screen.findByRole('button', { name: 'Use each mix’s arc' }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path === '/steer' &&
            (call.body as { action?: string }).action === 'energy_arc' &&
            (call.body as { value?: number[] | null }).value === null,
        ),
      ).toBe(true);
    });
  });

  it('lets the listener set a song as the destination for future mixes', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'GET /songs': [
        { id: 7, artist: 'Example Artist', title: 'Midnight', genre: 'pop', duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false },
        { id: 8, artist: 'Unready Artist', title: 'No Cues', genre: 'pop', duration: 200, bpm: 120, camelot: '8A', lyric_status: null, never: false, priority: false },
      ],
      'POST /steer': { mix_language: 'balanced', target: '7' },
    });
    show();
    fireEvent.change(await screen.findByLabelText('Take me to'), { target: { value: 'midnight' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Midnight — Example Artist' }));
    expect(await screen.findByText('Midnight — Example Artist')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No Cues — Unready Artist' })).toBeNull();
    expect(calls.some((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { action?: string; value?: string }).action === 'take_me_to' && (call.body as { value?: string }).value === '7')).toBe(true);
  });

  it('groups mixes by why you’d press them', async () => {
    fakeBackend({
      'GET /vibes': [
        card('pick', 'Selecta’s pick', ''),
        card('peak', 'Peak time', 'The moment'),
        card('feelings', 'In your feelings', 'The mood'),
        card('afro_heat', 'Afro heat', 'The sound'),
        card('slow_burn', 'Slow burn', 'The journey'),
      ],
    });
    show();
    const moment = (await screen.findByRole('heading', { name: 'The moment' })).parentElement!;
    expect(within(moment).getByRole('heading', { name: 'Peak time' })).toBeInTheDocument();
    expect(within(moment).queryByRole('heading', { name: 'In your feelings' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'The mood' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The sound' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The journey' })).toBeInTheDocument();
  });

  it('says what’s inside each one, from the songs that would really play', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time', 'The moment')] });
    show();
    const heading = await screen.findByRole('heading', { name: 'Peak time' });
    const inside = within(heading.closest('article')!);
    expect(inside.getByText('Someone, Someone Else')).toBeInTheDocument();
    expect(inside.getByText(/100–124 BPM/)).toBeInTheDocument();
    expect(inside.getByText(/Vocal rides and long blends/)).toBeInTheDocument();
    expect(inside.getByText('40 songs, up to 1 hr 5 min')).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Edit first' })).toBeEnabled();
  });

  it('keeps Christmas off the waiting list until there are enough songs for it', async () => {
    fakeBackend({
      'GET /vibes': [
        card('peak', 'Peak time', 'The moment'),
        card('christmas', 'Christmas', 'The sound', { ready: false, needs: 2 }),
        card('workout', 'Workout', 'The moment', { ready: false, needs: 3 }),
      ],
    });
    show();
    expect(await screen.findByText('needs 3 more')).toBeInTheDocument();
    expect(screen.queryByText('Christmas')).toBeNull();
  });
});

describe('a feeling kept as a draft', () => {
  it('builds it without touching what’s playing', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('peak', 'Peak time', 'The moment')],
      'POST /vibes/peak/build': { id: 4, name: 'Peak time', count: 12 },
      'GET /drafts': { drafts: [], current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
    });
    const notify = vi.fn();
    const setMixData = vi.fn();
    const player = new SetPlayer(() => [], () => {});
    render(
      <Mixes
        status={status()}
        mix={[]}
        mixName=""
        canUndo={false}
        refreshMix={() => {}}
        setMixData={setMixData}
        refreshStatus={() => {}}
        player={player}
        now={player.state}
        setView={() => {}}
        notify={notify}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Save Peak time as a draft' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'POST')?.path).toContain('as_draft=true');
    expect(setMixData).not.toHaveBeenCalled();
    expect(notify.mock.calls[0][0]).toContain('Nothing changed in what’s playing');
  });
});
