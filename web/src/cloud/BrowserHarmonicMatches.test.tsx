import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaResolver, ResolvedTrack } from '../media';
import { fakeBackend, Reply } from '../test/backend';
import { BrowserHarmonicMatches } from './BrowserHarmonicMatches';
import type { BrowserAudition, BrowserDiscovery, ProfileProgress } from './deviceMusicDiscoveries';

// cloud.browser_harmonic: Make a Mix > Harmonic matches in a browser library. The page says what
// it measured (whole-song keys, here) and what its preview plays (two stretches, as recorded).

const pair = (id: number, title_a: string, title_b: string, more: Partial<BrowserDiscovery> = {}, transpose = 0): BrowserDiscovery => ({
  id, song_a: id * 10 + 1, song_b: id * 10 + 2, title_a, title_b, artist_a: `Artist of ${title_a}`, artist_b: `Artist of ${title_b}`, status: 'new',
  payload: {
    a_at: 180, a_end: 200, b_at: 0, b_end: 20, bars: 0, transpose, method: 'whole_song_chroma_browser', similarity: 0.97, edge_similarity: 0.9,
    key_a: 'C major', key_b: 'G major', camelot_a: '8B', camelot_b: '9B',
  },
  score: 0.93,
  ...more,
});
const plan = (row: BrowserDiscovery): BrowserAudition => ({
  chords: [], bar_starts: [], seconds: 40, semitones: 0, kind: 'browser_edges',
  a: { song: row.song_a, from: row.payload.a_at, to: row.payload.a_end },
  b: { song: row.song_b, from: row.payload.b_at, to: row.payload.b_end },
});
const progress = (measured: number, songs: number, unreadable = 0): ProfileProgress => ({ songs, measured, unreadable });
const track = (): ResolvedTrack => ({ data: async () => new ArrayBuffer(8) }) as unknown as ResolvedTrack;
const everySong: MediaResolver = async () => track();

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  let made = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:preview-${made += 1}`), revokeObjectURL: vi.fn() }));
});

describe('Harmonic matches in the browser', () => {
  it('says honestly what it measures and what it does not', async () => {
    fakeBackend({ 'GET /discoveries': [pair(7, 'First', 'Second')], 'GET /discoveries/progress': progress(4, 10) });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'First into Second' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Harmonic matches' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Songs whose keys line up' })).toBeVisible();
    const page = screen.getByRole('main');
    expect(page).toHaveTextContent(/It doesn’t follow the chords bar by bar the way SelectaDJ on a computer does/);
    expect(page).toHaveTextContent(/Your music never leaves this device, and your answers stay in this browser and never add anything to a mix\./);
    expect(page).toHaveTextContent('Key match, a suggestion to check by ear, not a verified match');
    expect(page).toHaveTextContent('Measured here: C major (8B) and G major (9B).');
    expect(page).toHaveTextContent('1 to hear');
    // local mode's chord audition is not offered here
    expect(screen.queryByRole('button', { name: /Hear what SelectaDJ heard/ })).toBeNull();
    expect(page).not.toHaveTextContent(/share a chord pattern|chords SelectaDJ detected/);
  });

  it('says how far measuring has got, and when it is done', async () => {
    fakeBackend({ 'GET /discoveries': [pair(7, 'First', 'Second')], 'GET /discoveries/progress': progress(4, 10, 1) });
    const { unmount } = render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    expect(await screen.findByText(/4 of 10 songs on this device measured so far\. The rest are measured in spare time/)).toBeVisible();
    unmount();
    fakeBackend({ 'GET /discoveries': [], 'GET /discoveries/progress': progress(9, 10, 1) });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    expect(await screen.findByText('All 9 songs on this device that can be measured have been.')).toBeVisible();
    expect(screen.getByText('No harmonic matches yet. They turn up as more of the songs on this device are measured.')).toBeVisible();
  });

  it('says when a pair only lines up transposed, and that the preview plays both as recorded', async () => {
    fakeBackend({ 'GET /discoveries': [pair(7, 'First', 'Second', {}, -5)], 'GET /discoveries/progress': progress(2, 2) });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    expect(await screen.findByText(/line up most closely with one moved 5 semitones, but the keys already sit together, and the preview plays both as recorded\./)).toBeVisible();
  });

  it('plays the end of one song, then the start of the other, from the files on this device', async () => {
    const first = pair(7, 'First', 'Second');
    const calls = fakeBackend({ 'GET /discoveries': [first], 'GET /discoveries/progress': progress(2, 2), 'POST /discoveries/7/hear': plan(first) });
    const resolve = vi.fn(everySong);
    render(<BrowserHarmonicMatches resolveTrack={resolve} />);
    const steps = within(await screen.findByRole('list', { name: 'Two parts to hear' })).getAllByRole('button');
    expect(steps.map((step) => step.textContent?.replace(/^\d\s*/, ''))).toEqual(['The last 20 seconds of First', 'The first 20 seconds of Second']);
    expect(screen.getByText('Nothing is playing')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hear one into the other' }));
    expect(await screen.findByText('Now playing: The last 20 seconds of First')).toBeVisible();
    expect(resolve.mock.calls.map(([song]) => song)).toEqual([71, 72]);
    const player = screen.getByTestId('excerpt-player') as HTMLAudioElement;
    expect(player.src).toBe('blob:preview-1');
    // the first stretch reaching its end starts the second
    fireEvent.ended(player);
    expect(await screen.findByText('Now playing: The first 20 seconds of Second')).toBeVisible();
    expect(player.src).toBe('blob:preview-2');
    fireEvent.ended(player);
    expect(await screen.findByText('Nothing is playing')).toBeVisible();
    // one plan and one read of each file served both parts
    expect(calls.filter((call) => call.path === '/discoveries/7/hear')).toHaveLength(1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('stops when asked', async () => {
    const first = pair(7, 'First', 'Second');
    fakeBackend({ 'GET /discoveries': [first], 'GET /discoveries/progress': progress(2, 2), 'POST /discoveries/7/hear': plan(first) });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hear one into the other' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(screen.getByText('Nothing is playing')).toBeVisible();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('says so when one of the songs cannot be read on this device', async () => {
    const first = pair(7, 'First', 'Second');
    fakeBackend({ 'GET /discoveries': [first], 'GET /discoveries/progress': progress(2, 2), 'POST /discoveries/7/hear': plan(first) });
    render(<BrowserHarmonicMatches resolveTrack={async (song) => (song === 72 ? null : track())} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hear one into the other' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('One of these songs can’t be read on this device right now. Connect your music again to hear it.');
    expect(screen.getByText('Nothing is playing')).toBeVisible();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('records a Yes or No and moves on to the next pair', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [pair(7, 'First', 'Second'), pair(8, 'Third', 'Fourth')],
      'GET /discoveries/progress': progress(4, 4),
      'POST /discoveries/7/review': { id: 7, status: 'approved' },
    });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    const answers = within(await screen.findByRole('group', { name: 'Do First and Second sound connected?' }));
    fireEvent.click(answers.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Third into Fourth' })).toBeVisible();
    expect(calls.find((call) => call.path === '/discoveries/7/review')?.body).toEqual({ verdict: 'approved' });
    expect(screen.getByText('1 you’ve answered')).toBeInTheDocument();
    expect(screen.getByText('First and Second: connected')).toBeInTheDocument();
  });

  it('skips a pair for now without answering it', async () => {
    const calls = fakeBackend({ 'GET /discoveries': [pair(7, 'First', 'Second'), pair(8, 'Third', 'Fourth')], 'GET /discoveries/progress': progress(4, 4) });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Third into Fourth' })).toBeVisible();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(screen.getByText('2 to hear')).toBeVisible();
  });

  it('keeps the pair and says so when an answer cannot be saved', async () => {
    fakeBackend({ 'GET /discoveries': [pair(7, 'First', 'Second')], 'GET /discoveries/progress': progress(2, 2), 'POST /discoveries/7/review': new Reply(500, { detail: 'no' }) });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    fireEvent.click(await screen.findByRole('button', { name: 'No' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that. Try again.');
    expect(screen.getByRole('heading', { level: 3, name: 'First into Second' })).toBeVisible();
  });

  it('says when every pair has been heard, and lets an answer be changed', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [pair(7, 'First', 'Second', { status: 'rejected' })],
      'GET /discoveries/progress': progress(2, 2),
      'POST /discoveries/7/review': { id: 7, status: 'new' },
    });
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    expect(await screen.findByText('You’ve heard them all.')).toBeVisible();
    expect(screen.getByText('First and Second: not connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'First into Second' })).toBeVisible();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ verdict: 'new' });
  });

  it('says so when the pairs cannot be loaded, and offers to try again', async () => {
    fakeBackend({});
    render(<BrowserHarmonicMatches resolveTrack={everySong} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load these. Try again in a moment.');
    await waitFor(() => expect(screen.getByRole('button', { name: /Try again/ })).toBeVisible());
  });
});
