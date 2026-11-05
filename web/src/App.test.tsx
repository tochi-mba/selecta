import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fakeBackend, seam, songs, status } from './test/backend';

const data = (...items: Parameters<typeof songs>) => ({ mix: songs(...items), name: 'Test mix', can_undo: false });

function backend(mix: () => unknown) {
  return fakeBackend({
    'GET /status': status(),
    'GET /mix': mix,
    'GET /vibes': [],
    'GET /saved': [],
  });
}

describe('the badges', () => {
  it('follow the worker by themselves, without anyone pressing anything', async () => {
    let reads = 0;
    backend(() => {
      reads += 1;
      return reads < 3 ? data(seam('none', 'a')) : data(seam('ready', 'a', { duration: 30, a_source_start: 100, b_source_end: 10 }));
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Waiting to render')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument(), { timeout: 6000 });
  });

  it('stop asking once nothing is left to wait for', async () => {
    const mix = vi.fn(() => data(seam('ready', 'a', { duration: 30, a_source_start: 100, b_source_end: 10 })));
    backend(mix);
    render(<App />);
    await screen.findByRole('button', { name: 'Edit' });
    await waitFor(() => expect(mix).toHaveBeenCalled());
    await new Promise((done) => setTimeout(done, 400));
    const settled = mix.mock.calls.length;
    await new Promise((done) => setTimeout(done, 1800));
    expect(mix.mock.calls.length).toBe(settled);
  });
});

describe('when the mix can’t be read', () => {
  it('says so rather than showing an empty mix in silence', async () => {
    fakeBackend({ 'GET /status': status(), 'GET /vibes': [], 'GET /saved': [] });
    render(<App />);
    expect(await screen.findByText(/Couldn’t read your mix: Not Found/)).toBeInTheDocument();
  });
});

describe('a first run', () => {
  it('asks where the music is before anything else', async () => {
    fakeBackend({
      'GET /status': status({ counts: { total: 0, music: 0, set_aside: 0, analysed: 0, lyrics: 0 } }),
      'GET /mix': { mix: [], name: 'Your mix', can_undo: false },
    });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Where’s your music?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('keyboard shortcuts', () => {
  it('opens the list with ? and closes it with Escape', async () => {
    backend(() => data(seam('none', 'a')));
    render(<App />);
    await screen.findByRole('button', { name: 'Edit' });
    await userEvent.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
