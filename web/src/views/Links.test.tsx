import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/backend';
import { HarmonicDiscoveries } from './Links';

const discovery = (id: number, title_a: string, title_b: string, status = 'new') => ({
  id,
  song_a: id * 10 + 1,
  song_b: id * 10 + 2,
  title_a,
  title_b,
  artist_a: `Artist of ${title_a}`,
  artist_b: `Artist of ${title_b}`,
  status,
  payload: { a_at: 12, b_at: 30, a_end: 28, b_end: 46, bars: 8, transpose: 2 },
});

const audition = { chords: ['C', 'F', 'G', 'Am'], bar_starts: [0, 2, 4, 6], seconds: 8, semitones: 2 };
const hearButton = () => screen.findByRole('button', { name: /Hear what Selecta heard/ });

describe('songs that might share chords', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('plays what it detected in one press: the chords, each song, then both', async () => {
    fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second')],
      'POST /discoveries/7/hear': audition,
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    const player = screen.getByTestId('excerpt-player') as HTMLAudioElement;
    await waitFor(() => expect(player.src).toContain('/api/discoveries/7/hear/chords'));
    for (const step of ['a', 'b', 'both']) {
      fireEvent.ended(player);
      expect(player.src).toContain(`/api/discoveries/7/hear/${step}`);
    }
    fireEvent.ended(player);
    expect(await hearButton()).toBeInTheDocument();
  });

  it('shows the chords it read and lights the one being played', async () => {
    fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second')],
      'POST /discoveries/7/hear': audition,
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    expect(await screen.findByText('Am')).toBeInTheDocument();
    const player = screen.getByTestId('excerpt-player') as HTMLAudioElement;
    Object.defineProperty(player, 'currentTime', { value: 2.5, configurable: true });
    fireEvent.timeUpdate(player);
    expect(screen.getByText('F')).toHaveClass('now');
    expect(screen.getByText('C')).not.toHaveClass('now');
  });

  it('lets you jump to any step', async () => {
    fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second')],
      'POST /discoveries/7/hear': audition,
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Both at once' }));
    expect((screen.getByTestId('excerpt-player') as HTMLAudioElement).src).toContain('/hear/both');
    expect(screen.getByRole('button', { name: 'Both at once' })).toHaveAttribute('aria-current', 'step');
  });

  it('says how long it will take while it gets ready', async () => {
    let finish: (value: unknown) => void = () => {};
    const waiting = new Promise((resolve) => { finish = resolve; });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') await waiting;
        const body = init?.method === 'POST' ? audition : [discovery(7, 'First', 'Second')];
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    render(<HarmonicDiscoveries secondsToPrepare={30} />);
    fireEvent.click(await hearButton());
    expect(await screen.findByRole('button', { name: 'Getting it ready, under a minute' })).toBeDisabled();
    await act(async () => { finish(null); });
  });

  it('answering moves straight on to the next pair, and keeps playing', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second'), discovery(8, 'Third', 'Fourth')],
      'POST /discoveries/7/hear': audition,
      'POST /discoveries/8/hear': audition,
      'POST /discoveries/7/review': { id: 7, status: 'approved' },
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    await screen.findByText('Am');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByRole('heading', { name: /Third/ })).toBeInTheDocument();
    expect(calls.find((call) => call.path === '/discoveries/7/review')?.body).toEqual({ verdict: 'approved' });
    const player = screen.getByTestId('excerpt-player') as HTMLAudioElement;
    await waitFor(() => expect(player.src).toContain('/api/discoveries/8/hear/chords'));
  });

  it('gets the next pair ready before you reach it', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second'), discovery(8, 'Third', 'Fourth')],
      'POST /discoveries/7/hear': audition,
      'POST /discoveries/8/hear': audition,
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    await waitFor(() => expect(calls.some((call) => call.path === '/discoveries/8/hear')).toBe(true));
  });

  it('skipping puts a pair at the back without answering it', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second'), discovery(8, 'Third', 'Fourth')],
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: /Third/ })).toBeInTheDocument();
    expect(calls.some((call) => call.path.endsWith('/review'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: /First/ })).toBeInTheDocument();
  });

  it('does not offer to skip the only one left', async () => {
    fakeBackend({ 'GET /discoveries': [discovery(7, 'First', 'Second')] });
    render(<HarmonicDiscoveries />);
    await hearButton();
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
  });

  it('never talks about semitones or harmonic shapes', async () => {
    fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second')],
      'POST /discoveries/7/hear': audition,
    });
    const { container } = render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    await screen.findByText('Am');
    expect(container.textContent).not.toMatch(/semitone|harmonic|transpos|chroma/i);
  });

  it('pauses the mix when it starts playing', async () => {
    fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second')],
      'POST /discoveries/7/hear': audition,
    });
    const onListen = vi.fn();
    render(<HarmonicDiscoveries onListen={onListen} />);
    fireEvent.click(await hearButton());
    await waitFor(() => expect(onListen).toHaveBeenCalled());
  });

  it('stopping really stops, and answering afterwards does not start it again', async () => {
    fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second'), discovery(8, 'Third', 'Fourth')],
      'POST /discoveries/7/hear': audition,
      'POST /discoveries/8/hear': audition,
      'POST /discoveries/7/review': { id: 7, status: 'rejected' },
    });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    fireEvent.click(await screen.findByRole('button', { name: '■ Stop' }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(await screen.findByRole('heading', { name: /Third/ })).toBeInTheDocument();
    expect(await hearButton()).toBeInTheDocument();
  });

  it('says so when a pair cannot be played, and you can still answer', async () => {
    fakeBackend({ 'GET /discoveries': [discovery(7, 'First', 'Second')] });
    render(<HarmonicDiscoveries />);
    fireEvent.click(await hearButton());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeEnabled();
  });

  it('keeps answers out of the way, and they can be changed', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [discovery(7, 'First', 'Second', 'approved')],
      'POST /discoveries/7/review': { id: 7, status: 'new' },
    });
    render(<HarmonicDiscoveries />);
    expect(await screen.findByText('You’ve heard them all.')).toBeInTheDocument();
    expect(screen.getByText('1 you’ve answered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ verdict: 'new' }));
    expect(await hearButton()).toBeInTheDocument();
  });

  it('stays out of the way when there is nothing to show', async () => {
    fakeBackend({ 'GET /discoveries': [] });
    const { container } = render(<HarmonicDiscoveries />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when they cannot be loaded', async () => {
    fakeBackend({});
    render(<HarmonicDiscoveries />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load these');
  });
});
