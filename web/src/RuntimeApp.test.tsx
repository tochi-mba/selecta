import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETRY_MS, RuntimeApp } from './RuntimeApp';

vi.mock('./App', () => ({ App: () => <p>The local app</p> }));

afterEach(() => {
  vi.useRealTimers();
});

const answering = (up: () => boolean) => vi.fn(async () => {
  if (!up()) throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify({ counts: { total: 1 } }), { status: 200 });
});

describe('before the app knows what it is', () => {
  it('picks up by itself when a server that wasn’t there starts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let up = false;
    const fetch = answering(() => up);
    vi.stubGlobal('fetch', fetch);
    render(<RuntimeApp />);
    expect(await screen.findByRole('heading', { name: 'Can’t reach Selecta.' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'Can’t reach Selecta.' })).toBeInTheDocument();
    up = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS + 100); });
    expect(await screen.findByText('The local app')).toBeInTheDocument();
    // and once it's there, it stops asking
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_MS * 3); });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('tries again straight away when asked to', async () => {
    let up = false;
    vi.stubGlobal('fetch', answering(() => up));
    render(<RuntimeApp />);
    expect(await screen.findByRole('heading', { name: 'Can’t reach Selecta.' })).toBeInTheDocument();
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    expect(await screen.findByText('The local app')).toBeInTheDocument();
  });
});
