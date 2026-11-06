import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/backend';
import { HarmonicDiscoveries } from './Links';

const discovery = (id: number, title_a: string, title_b: string, status = 'new', transpose = 0) => ({
  id,
  song_a: id * 10 + 1,
  song_b: id * 10 + 2,
  title_a,
  title_b,
  artist_a: 'Artist A',
  artist_b: 'Artist B',
  status,
  payload: { a_at: 12, b_at: 30, a_end: 28, b_end: 46, bars: 8, transpose },
});

const open = async () => {
  const heading = await screen.findByText('Songs that might share chords');
  fireEvent.click(heading);
};

describe('songs that might share chords', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('plays just the matching part, from the right place, and stops by itself', async () => {
    fakeBackend({ 'GET /discoveries': [discovery(7, 'First', 'Second')] });
    render(<HarmonicDiscoveries />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Second/ }));
    const player = screen.getByTestId('excerpt-player') as HTMLAudioElement;
    expect(player.getAttribute('src') ?? player.src).toContain('/api/songs/72/audio');
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(30);
    expect(screen.getByRole('button', { name: /Second/ })).toHaveAttribute('aria-pressed', 'true');
    player.currentTime = 47;
    fireEvent.timeUpdate(player);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Second/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('can play the two one after the other', async () => {
    fakeBackend({ 'GET /discoveries': [discovery(7, 'First', 'Second')] });
    render(<HarmonicDiscoveries />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Play one after the other' }));
    const player = screen.getByTestId('excerpt-player') as HTMLAudioElement;
    expect(player.src).toContain('/api/songs/71/audio');
    player.currentTime = 29;
    fireEvent.timeUpdate(player);
    expect(player.src).toContain('/api/songs/72/audio');
  });

  it('asks a plain question, saves the answer, and moves the song pair out of the way', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second')],
      'POST /discoveries/7/review': { id: 7, status: 'approved' },
    });
    render(<HarmonicDiscoveries />);
    await open();
    expect(screen.getByText('Hear a connection?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getByText('You’ve listened to them all.')).toBeInTheDocument());
    expect(screen.getByText('First and Second: connected')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/discoveries/7/review' && (call.body as { verdict: string }).verdict === 'approved')).toBe(true);
    expect(calls.some((call) => call.path.startsWith('/mix'))).toBe(false);
  });

  it('never talks about semitones or harmonic shapes', async () => {
    fakeBackend({ 'GET /discoveries': [discovery(7, 'First', 'Second', 'new', 10)] });
    const { container } = render(<HarmonicDiscoveries />);
    await open();
    expect(container.textContent).not.toMatch(/semitone|transpose|harmonic|audition|cue/i);
    expect(screen.getByText(/listen for the pattern/)).toBeInTheDocument();
  });

  it('starts with a few, and shows more when asked', async () => {
    const many = Array.from({ length: 8 }, (_, i) => discovery(i + 1, `A${i}`, `B${i}`));
    fakeBackend({ 'GET /discoveries': many });
    render(<HarmonicDiscoveries />);
    await open();
    expect(screen.queryByRole('button', { name: /A7/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }));
    expect(screen.getByRole('button', { name: /A7/ })).toBeInTheDocument();
  });

  it('pauses the mix when a part starts playing', async () => {
    fakeBackend({ 'GET /discoveries': [discovery(7, 'First', 'Second')] });
    const onListen = vi.fn();
    render(<HarmonicDiscoveries onListen={onListen} />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: /First/ }));
    expect(onListen).toHaveBeenCalledOnce();
  });

  it('stays out of the way when there is nothing to show', async () => {
    const calls = fakeBackend({ 'GET /discoveries': [] });
    const { container } = render(<HarmonicDiscoveries />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((done) => setTimeout(done, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when they cannot be loaded', async () => {
    fakeBackend({});
    render(<HarmonicDiscoveries />);
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load these');
  });
});
