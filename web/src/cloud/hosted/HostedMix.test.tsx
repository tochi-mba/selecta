import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../api';
import { HostedMix } from './HostedMix';
import { analysedWords, downloadWords, exportWords, recordingsOf, renderDetail, type HostedSong } from './hostedWords';

// The hosted Make a Mix card (cloud.hosted_render): one primary action per state, button names
// that never carry busy words while idle, and words only for numbers the server really gave.

const song = (id: string, name: string, state: 'done' | 'failed' | 'running' = 'done', extra: Partial<HostedSong> = {}): HostedSong => ({
  asset_id: id, name, analysis: { state: state === 'done' ? 'ready' : state }, status: { state, can_retry: state === 'failed', reason: state === 'failed' ? 'The file could not be read.' : null }, ...extra,
});
const SONGS = [song('a', 'Morgan Wallen - Last Night.mp3'), song('b', 'Miley Cyrus - Flowers.mp3'), song('c', 'SZA - Kill Bill.mp3')];
const songsAnswer = (songs: HostedSong[]) => ({
  songs, counts: { ready: 0, running: 0, queued: 0, failed: 0, not_started: 0 }, estimate_s: null, seconds_each: 60, total: songs.length,
  totals: { waiting: 0, running: songs.filter((one) => one.status?.state === 'running').length, done: songs.filter((one) => one.status?.state === 'done').length, failed: songs.filter((one) => one.status?.state === 'failed').length, total: songs.length },
  moving: false,
});
const PLAN = { songs: [{ asset_id: 'a', move: null }, { asset_id: 'b', move: 'bass_swap_blend' }] };
const part = (kind: 'song' | 'seam', asset_id?: string) => ({ kind, from_s: 0, seconds: 60, url: `https://store.test/${asset_id ?? 'seam'}.flac?sig=1`, asset_id });
const MIX = {
  parts: [part('song', 'a'), part('seam'), part('song', 'b')],
  seams: [{ index: 0, state: 'ready', planned_move: 'bass_swap_blend', move: 'bass_swap_blend', passed: true }],
  complete: true, estimate_s: null, worker_seen: true,
  counts: { seams_ready: 1, seams_failed: 0, seams: 1, songs_analysed: 2, songs: 2, files_ready: 2 },
};

function fakeApi(answers: Record<string, unknown | (() => unknown)>): Api {
  return (async (path: string) => {
    const key = Object.keys(answers).find((one) => path.startsWith(one));
    if (!key) throw new Error(`no answer for ${path}`);
    const answer = answers[key];
    return typeof answer === 'function' ? (answer as () => unknown)() : answer;
  }) as Api;
}

afterEach(() => vi.restoreAllMocks());

describe('HostedMix card', () => {
  it('before a mix: Make a mix is the one primary action, named without busy words', async () => {
    render(<HostedMix api={fakeApi({ '/hosted/songs': songsAnswer(SONGS) })} workspaceId="ws" />);
    const make = await screen.findByRole('button', { name: 'Make a mix' });
    expect(make).toHaveClass('primary');
    expect(make).toHaveAccessibleName('Make a mix');
    expect(make.textContent).toBe('Make a mix');
    expect(make).not.toHaveAttribute('aria-busy');
  });

  it('with a mix: Play is primary, Make another mix and Export are real secondary buttons, idle names are clean', async () => {
    let planned = false;
    render(<HostedMix api={fakeApi({ '/hosted/songs': songsAnswer(SONGS), '/hosted/mixes/plan': () => { planned = true; return PLAN; }, '/hosted/mixes/render': MIX })} workspaceId="ws" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make a mix' }));
    await waitFor(() => expect(planned).toBe(true));
    const play = await screen.findByRole('button', { name: 'Play the mix' });
    expect(play).toHaveClass('primary');
    const another = screen.getByRole('button', { name: 'Make another mix' });
    const exportButton = screen.getByRole('button', { name: 'Export the whole mix' });
    for (const button of [another, exportButton]) {
      expect(button).not.toHaveClass('primary');
      expect(button).not.toHaveClass('quiet'); // quiet draws as plain text: these are buttons
      expect(button.textContent).not.toMatch(/Planning|Exporting/);
    }
    expect(screen.getAllByRole('button', { name: /^Play from / }).map((row) => row.getAttribute('aria-label'))).toEqual(['Play from Last Night by Morgan Wallen', 'Play from Flowers by Miley Cyrus']);
    expect(screen.getByRole('meter', { name: 'Mix progress' })).toHaveAttribute('aria-valuetext', '0:00 of 3:00');
  });

  it('a failed song has its own named Try again', async () => {
    render(<HostedMix api={fakeApi({ '/hosted/songs': songsAnswer([...SONGS, song('d', 'Doja Cat - Paint The Town Red.mp3', 'failed')]) })} workspaceId="ws" />);
    const again = await screen.findByRole('button', { name: 'Try Paint The Town Red again' });
    expect(again.textContent).toBe('Try again');
  });

  it('exporting says so once in the status line and shows real parts; ready gives a plain download link with its size', async () => {
    let polls = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<HostedMix api={fakeApi({
        '/hosted/songs': songsAnswer(SONGS), '/hosted/mixes/plan': PLAN, '/hosted/mixes/render': MIX,
        '/hosted/mixes/export': { state: 'queued', job_id: 'j1', parts_done: 0, parts_total: 4, progress: [0, 4] },
        '/hosted/exports/': () => (polls += 1) === 1 ? { state: 'running', parts_done: 2, parts_total: 4, progress: [2, 4], estimate_s: 30, worker_seen: true } : { state: 'ready', url: 'https://store.test/mix.flac?sig=1', size_bytes: 107e6, seconds: 547 },
      })} workspaceId="ws" />);
      await userEvent.click(await screen.findByRole('button', { name: 'Make a mix' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Export the whole mix' }));
      expect(await screen.findByText('Exporting the mix on SelectaDJ’s servers.')).toHaveAttribute('role', 'status');
      // while busy, and only then, the busy words are the name
      expect(screen.getByRole('button', { name: 'Exporting…' })).toHaveAttribute('aria-busy', 'true');
      await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
      expect(screen.getByRole('progressbar', { name: 'Exporting the mix' })).toHaveAttribute('aria-valuetext', 'Part 3 of 3');
      await act(async () => { await vi.advanceTimersByTimeAsync(6500); });
      const link = await screen.findByRole('link', { name: 'Download the mix (lossless FLAC, 107 MB)' });
      expect(link).toHaveAttribute('href', 'https://store.test/mix.flac?sig=1');
      expect(link).toHaveAttribute('download');
    } finally { vi.useRealTimers(); }
  });
});

describe('hosted words', () => {
  it('says why there is no time left, and never makes one up', () => {
    expect(renderDetail({ estimate_s: null, estimate_why: 'no_worker' })).toMatch(/^Waiting for a SelectaDJ server/);
    expect(renderDetail({ estimate_s: null, estimate_why: 'overrunning' })).toBe('Taking longer than usual, and still going. Play opens when every part is ready.');
    expect(renderDetail({ estimate_s: null, estimate_why: 'busy' })).toMatch(/busy with other mixes; yours is in line/);
    expect(renderDetail({ estimate_s: null, worker_seen: true })).toBe('Play opens when every part is ready.');
    expect(renderDetail({ estimate_s: null, worker_seen: false })).toMatch(/^Waiting for a SelectaDJ server/); // an older server
    expect(renderDetail({ estimate_s: 200, estimate_why: null })).toBe('About 3 minutes left. Play opens when every part is ready.');
  });

  it('an export shows a fraction and a time only when the server sends them', () => {
    expect(exportWords({ state: 'running' })).toEqual({ fraction: null, value: 'Joining the mix', detail: null });
    expect(exportWords({ state: 'running', progress: [1, 5] })).toMatchObject({ fraction: 0.2, value: 'Part 2 of 4', detail: null });
    expect(exportWords({ state: 'running', parts_done: 4, parts_total: 5, estimate_s: 20 })).toEqual({ fraction: 0.8, value: 'Saving the file', detail: 'Less than a minute left.' });
    expect(exportWords({ state: 'queued', worker_seen: false }).detail).toMatch(/^Waiting for a SelectaDJ server/);
    expect(exportWords({ state: 'refused', why: 'The mix isn’t ready yet: export opens once every part of it is ready.' }).detail).toBe('The mix isn’t ready yet: export opens once every part of it is ready.');
    expect(exportWords({ state: 'failed', why: 'It stopped.' }).detail).toBe('The export could not be made: It stopped.');
  });

  it('warns before a large download on a phone', () => {
    const big = { state: 'ready', url: 'u', size_bytes: 530e6, seconds: 2700 };
    expect(downloadWords(big, true).note).toMatch(/^A large file \(45:00 long, 530 MB\): download it over Wi-Fi/);
    expect(downloadWords(big, false).note).toBe('One 24-bit file of the mix exactly as it plays: 45:00 long, 530 MB.');
    expect(downloadWords({ state: 'ready', url: 'u' }, true)).toEqual({ label: 'Download the mix (lossless FLAC)', note: null });
  });

  it('counts copies of one recording once', () => {
    const songs = [song('a', 'x'), song('b', 'y', 'done', { same_recording_as: ['c'] }), song('c', 'y copy', 'done', { same_recording_as: ['b'] }), song('d', 'z', 'done', { same_file_as: ['e'] }), song('e', 'z', 'done', { same_file_as: ['d'] })];
    expect(recordingsOf(songs)).toEqual({ done: 5, recordings: 3 });
    expect(analysedWords(5, 3, 0)).toBe('5 songs analysed, 3 different recordings (a mix plays each recording once).');
    expect(analysedWords(4, 4, 1)).toBe('4 songs analysed; 1 could not be.');
  });
});
