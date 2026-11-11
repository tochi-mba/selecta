import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/** UF-0374-02: word highlights are an alignment, not the sung word. Listen says how good the timing it
 * follows really is, and never invents timing for a song that has none. */

const item: MixItem = { position: 0, song_id: 7, artist: 'A', title: 'Song', duration: 60, bpm: 120, key: '8A', locked: false, seam: null };
const base: SongDetail = { id: 7, artist: 'A', title: 'Song', duration: 60, bpm: 120, key: '8A', peaks: [], sections: [], lines: [] } as unknown as SongDetail;

function listen(detail: Partial<SongDetail>) {
  fakeBackend({ 'GET /status': status(), 'GET /songs/7': { ...base, ...detail } });
  const player = new SetPlayer(() => [item], () => {});
  render(
    <Now status={status()} mix={[item]} mixName="Mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2, duration: 60 }}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

describe('timed lyrics say how they are timed', () => {
  it('word-aligned lyrics say their timing may be approximate', async () => {
    listen({ lyric_status: 'synced', lines: [{ start: 1, end: 4, text: 'one two', words: [{ start: 1, end: 2 }, { start: 2, end: 4 }] }] } as Partial<SongDetail>);
    expect(await screen.findByText('Word highlights follow stored lyric alignment; timing may be approximate.')).toBeInTheDocument();
  });

  it('line-timed lyrics never claim word timing', async () => {
    listen({ lyric_status: 'synced', lines: [{ start: 1, end: 4, text: 'one two' }] } as Partial<SongDetail>);
    expect(await screen.findByText('Line-timed lyrics; individual word timing unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/timing may be approximate/)).toBeNull();
  });

  it('untimed lyrics say so instead of following along', async () => {
    listen({ lyric_status: 'plain', lines: [] });
    expect(await screen.findByText('Lyrics for this song aren’t timed, so they can’t follow along.')).toBeInTheDocument();
  });

  it('a song with no lyrics says why, and the transport is still there', async () => {
    listen({ lyric_status: 'instrumental', lines: [] });
    expect(await screen.findByText('Instrumental')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });
});
