import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';

/**
 * S4-0098-04: long, missing, untimed and right-to-left lyrics stay readable, the active line is
 * marked, and the block keeps the same number of rows at every moment of the song, so following
 * along never makes the page jump.
 */
const mix: MixItem[] = [{ position: 0, song_id: 1, artist: 'Artist', title: 'Song', duration: 40, bpm: 120, key: '8A', locked: false, seam: null }];

const LONG = 'a lyric line long enough to wrap across the whole stage at every width and then some more words';
const lines = [
  { start: 2, end: 5, text: 'مرحبا بالليل الطويل' },
  { start: 6, end: 9, text: 'שלום לך עולם' },
  { start: 10, end: 13, text: LONG },
  { start: 14, end: 17, text: 'Mixed English و عربي together' },
  { start: 18, end: 21, text: '夜の音楽が流れる' },
];
const detail = (over: Partial<SongDetail> = {}): SongDetail => ({
  id: 1, artist: 'Artist', title: 'Song', duration: 40, bpm: 120, key: '8A', peaks: [], bar_times: [0, 8, 16, 24, 32],
  beat_times: [], beats_per_bar: 4, sections: [], lines, lyric_status: 'synced', ...over,
});

function view(time: number, stage = false) {
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Now status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: time, duration: 40 }}
      setView={() => {}} notify={() => {}} stage={stage} toggleStage={() => {}} />
  );
}

const block = () => document.querySelector('.lyrics') as HTMLElement;
const rows = () => [...block().querySelectorAll(':scope > p:not(.lyric-confidence)')] as HTMLElement[];

describe('S4-0098-04 lyric typography, active line and steady rows', () => {
  it('every line sets its own direction, so Arabic, Hebrew, mixed and CJK lines read whole', async () => {
    fakeBackend({ 'GET /songs/1': detail() });
    render(view(7));
    expect(await screen.findByText('שלום לך עולם')).toBeInTheDocument();
    for (const row of rows()) expect(row).toHaveAttribute('dir', 'auto');
    const sung = block().querySelector('p.sung') as HTMLElement;
    expect(sung).toHaveTextContent('שלום לך עולם');
    expect(rows().filter((row) => row.classList.contains('sung'))).toHaveLength(1);
  });

  it('keeps the same number of rows before the first line, during, between and after the last', async () => {
    fakeBackend({ 'GET /songs/1': detail() });
    const shown = render(view(0));
    await screen.findByText('مرحبا بالليل الطويل');
    const counts: number[] = [];
    for (const time of [0, 3, 5.5, 11, 19, 35]) {
      shown.rerender(view(time));
      counts.push(rows().length);
    }
    expect(new Set(counts).size).toBe(1);
    // long after the last line, nothing is marked as being sung
    expect(block().querySelector('p.sung')).toBeNull();
  });

  it('a long line is the active line in full, never cut short', async () => {
    fakeBackend({ 'GET /songs/1': detail() });
    render(view(11));
    const sung = await within(document.body).findByText(LONG);
    expect(sung.closest('p')).toHaveClass('sung');
    expect(sung.closest('p')).toHaveTextContent(LONG);
  });

  it('untimed right-to-left lyrics are labelled untimed and invent no active line', async () => {
    fakeBackend({ 'GET /songs/1': detail({ lyric_status: 'plain', lines: [{ start: 0, end: 0, text: 'كلمات بلا توقيت' }] }) });
    render(view(10));
    expect(await screen.findByText('Untimed lyrics - word timing unavailable.')).toBeInTheDocument();
    expect(block().querySelector('p.sung')).toBeNull();
  });

  it('missing lyrics say why in the same quiet block', async () => {
    fakeBackend({ 'GET /songs/1': detail({ lyric_status: null, lines: [] }) });
    render(view(10));
    expect(await screen.findByText('Lyrics haven’t been looked up yet.')).toBeInTheDocument();
    expect(block()).toHaveClass('quiet');
  });
});
