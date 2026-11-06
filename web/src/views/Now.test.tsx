import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

const mix: MixItem[] = [
  {
    position: 0,
    song_id: 1,
    artist: 'Test Artist',
    title: 'Test Song',
    duration: 20,
    bpm: 120,
    key: '8A',
    locked: false,
    seam: null,
  },
];

const detail: SongDetail = {
  id: 1,
  artist: 'Test Artist',
  title: 'Test Song',
  duration: 20,
  bpm: 120,
  key: '8A',
  peaks: [],
  sections: [],
  lines: [
    {
      start: 1,
      end: 4,
      text: 'Hello, beautiful world!',
      words: [
        { start: 1, end: 2 },
        { start: 2, end: 3 },
        { start: 3, end: 4 },
      ],
    },
  ],
};

function view(time: number) {
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Now
      status={status()}
      mix={mix}
      mixName="Test mix"
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={{ ...player.state, phase: 'playing', position: 0, songTime: time, duration: 20 }}
      setView={() => {}}
      notify={() => {}}
      stage
      toggleStage={() => {}}
    />
  );
}

describe('word focus on the Now and Stage screens', () => {
  it('follows the current playback time and keeps the lyric punctuation', async () => {
    fakeBackend({ 'GET /songs/1': detail });
    const rendered = render(view(2.5));
    expect(await screen.findByText('Hello')).toHaveTextContent('Hello');
    expect(screen.getByText('beautiful')).toHaveClass('current-word');
    expect(screen.getByText('beautiful').closest('p')).toHaveTextContent('Hello, beautiful world!');

    rendered.rerender(view(3.5));
    expect(screen.getByText('world')).toHaveClass('current-word');
    expect(screen.getByText('beautiful')).not.toHaveClass('current-word');
  });

  it('keeps line lyrics visible when word timing is unavailable', async () => {
    fakeBackend({ 'GET /songs/1': { ...detail, lines: [{ start: 1, end: 4, text: 'No word timing' }] } });
    render(view(2.5));
    const firstWord = await screen.findByText('No');
    expect(firstWord.closest('p')).toHaveTextContent('No word timing');
    expect(firstWord).not.toHaveClass('current-word');
  });
});
