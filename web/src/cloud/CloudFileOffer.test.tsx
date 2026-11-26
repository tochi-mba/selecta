import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MixItem, Request } from '../api';
import { RequestContext } from '../requestContext';
import { CLOUD_FILE, CloudFileOffer } from './CloudFileOffer';

// "Make the file in your cloud library" in the Export panel (cloud.one_mixer): shown only when the
// adapter says every song is in the cloud library, recommended on a phone, and the file followed
// to its download link.

const item = (song_id: number, position: number): MixItem => ({ position, song_id, artist: 'Rex', title: `Song ${song_id}`, duration: 120, bpm: null, key: null, locked: false, seam: null });
const MIX = [item(1, 0), item(2, 1)];

function phone(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

function offer(answers: Record<string, unknown>) {
  const asked: { path: string; method: string; order: string | null }[] = [];
  const request = (async (path: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    asked.push({ path, method, order: new Headers(init?.headers).get('x-mix-order') });
    return answers[`${method} ${path}`];
  }) as Request;
  const onFirst = vi.fn();
  render(<RequestContext.Provider value={request}><CloudFileOffer mix={MIX} onFirst={onFirst} /></RequestContext.Provider>);
  return { asked, onFirst };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Make the file in your cloud library', () => {
  it('shows nothing when a song is outside the cloud library', async () => {
    phone(false);
    const { asked } = offer({ 'GET /exports/cloud': { offered: false } });
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(screen.queryByRole('heading', { name: CLOUD_FILE })).toBeNull();
  });

  it('is offered beside Save it on a computer, and asks for the file with the mix as shown', async () => {
    phone(false);
    const { asked, onFirst } = offer({ 'GET /exports/cloud': { offered: true }, 'POST /exports/cloud': { state: 'ready', url: 'https://r2.test/mix.flac', size_bytes: 50e6 } });
    const button = await screen.findByRole('button', { name: CLOUD_FILE });
    expect(button).not.toHaveClass('primary');
    expect(onFirst).toHaveBeenLastCalledWith(false);
    fireEvent.click(button);
    expect(await screen.findByRole('link', { name: /Download the mix/ })).toHaveAttribute('href', 'https://r2.test/mix.flac');
    expect(asked.at(-1)).toEqual({ path: '/exports/cloud', method: 'POST', order: '1,2' });
  });

  it('is recommended on a phone, so the panel’s own Save it steps back', async () => {
    phone(true);
    const { onFirst } = offer({ 'GET /exports/cloud': { offered: true } });
    expect(await screen.findByRole('button', { name: CLOUD_FILE })).toHaveClass('primary');
    expect(screen.getByText(/Recommended on phones/)).toBeInTheDocument();
    await waitFor(() => expect(onFirst).toHaveBeenLastCalledWith(true));
  });

  it('says how far the transitions have got while the parts are made, and what was refused', async () => {
    phone(false);
    offer({ 'GET /exports/cloud': { offered: true }, 'POST /exports/cloud': { state: 'preparing', counts: { seams_ready: 0, seams: 1, files_ready: 1, songs: 2 } } });
    fireEvent.click(await screen.findByRole('button', { name: CLOUD_FILE }));
    expect(await screen.findByText('Getting transitions ready')).toBeInTheDocument();
    cleanup();
    offer({ 'GET /exports/cloud': { offered: true }, 'POST /exports/cloud': { state: 'refused', why: 'Your storage is over your plan’s limit.' } });
    fireEvent.click(await screen.findByRole('button', { name: CLOUD_FILE }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your storage is over your plan’s limit.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
