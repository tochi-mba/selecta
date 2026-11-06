import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

const row = (id: number, title: string) => ({
  id,
  artist: 'Someone',
  title,
  genre: null,
  duration: 200,
  bpm: null,
  camelot: null,
  lyric_status: null,
  never: false,
  priority: false,
});

function show(state = status(), refreshStatus = () => {}, notify: (m: string) => void = () => {}) {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library
      status={state}
      mix={[]}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={refreshStatus}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={notify}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

describe('songs not analysed yet', () => {
  it('shows each song’s place in one line, so clicks can’t pile up', async () => {
    fakeBackend({ 'GET /songs': [row(1, 'First'), row(2, 'Second'), row(3, 'Third')] });
    show(status({ analysing: [1, 2] }));
    await userEvent.click(screen.getByRole('button', { name: 'Not analysed yet' }));
    expect(await screen.findByRole('button', { name: 'Analysing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Waiting, 1 ahead' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Analyse now' })).toBeEnabled();
  });

  it('offers the whole lot in one press', async () => {
    const calls = fakeBackend({ 'GET /songs': [row(1, 'First')], 'POST /analysis/start': { running: true } });
    const refreshStatus = vi.fn();
    show(status(), refreshStatus);
    await userEvent.click(screen.getByRole('button', { name: 'Not analysed yet' }));
    expect(screen.getByText(/40 songs left/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Analyse them all' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/analysis/start')).toBe(true));
    expect(refreshStatus).toHaveBeenCalled();
  });

  it('doesn’t offer it twice', async () => {
    fakeBackend({ 'GET /songs': [row(1, 'First')] });
    show(status({ analysis_running: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Not analysed yet' }));
    expect(screen.queryByRole('button', { name: 'Analyse them all' })).toBeNull();
    expect(screen.getByRole('button', { name: /Analysing now/ })).toBeInTheDocument();
  });

  it('lets the listener prioritize a song and shows the priority list', async () => {
    const calls = fakeBackend({
      'GET /songs': [row(1, 'First')],
      'POST /songs/1/priority': { song_id: 1, priority: 100 },
    });
    show();
    await screen.findByText('First');
    await userEvent.click(screen.getByRole('button', { name: 'Prioritize' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/songs/1/priority?priority=100')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Priority list' }));
    await waitFor(() => expect(calls.some((call) => call.path.includes('state=priority'))).toBe(true));
  });
});
