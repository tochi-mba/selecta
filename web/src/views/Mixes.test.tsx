import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Mixes
      status={status()}
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
  it('waits for six mix-ready songs even when audio analysis has finished on more', async () => {
    fakeBackend({ 'GET /vibes': [], 'GET /saved': [] });
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
      'GET /saved': [],
      'POST /steer': { mix_language: 'seamless' },
    });
    show();
    const select = await screen.findByLabelText('Transition feel');
    fireEvent.change(select, { target: { value: 'seamless' } });
    expect(await screen.findByRole('combobox', { name: 'Transition feel' })).toHaveValue('seamless');
    expect(calls.some((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { value?: string }).value === 'seamless')).toBe(true);
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
      'GET /saved': [],
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
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time', 'The moment')], 'GET /saved': [] });
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
      'GET /saved': [],
    });
    show();
    expect(await screen.findByText('needs 3 more')).toBeInTheDocument();
    expect(screen.queryByText('Christmas')).toBeNull();
  });
});
