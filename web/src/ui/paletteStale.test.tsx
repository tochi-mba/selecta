import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';

// SF-0244-05: a slow answer for something typed earlier can never be shown or chosen once the box
// says something else, whatever order the answers arrive in.

const song = (id: number, title: string) => ({ id, title, artist: 'Artist', bpm: null, readiness: { status: 'ready', reason: '' } });

describe('palette song search races', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores an older answer that lands after the newer one', async () => {
    const waiting = new Map<string, (body: unknown) => void>();
    vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>((done) => {
      const words = new URL(url, 'http://local').searchParams.get('q') ?? '';
      waiting.set(words, (body) => done(new Response(JSON.stringify(body), { status: 200 })));
    })));
    window.history.pushState({}, '', '/listen');
    const close = vi.fn();
    render(<CommandPalette commands={[]} onClose={close} />);
    const box = screen.getByRole('combobox', { name: 'Search for a page or a command' });

    fireEvent.change(box, { target: { value: 'Neon' } });
    await act(async () => { await new Promise((wait) => setTimeout(wait, 200)); });
    fireEvent.change(box, { target: { value: 'Paper' } });
    await act(async () => { await new Promise((wait) => setTimeout(wait, 200)); });
    expect([...waiting.keys()]).toEqual(['Neon', 'Paper']);

    // the newer answer first, then the older one turns up late
    await act(async () => { waiting.get('Paper')!({ songs: [song(2, 'Paper Moon')], total: 1, next: null }); });
    expect(await screen.findByRole('option', { name: /Song: Paper Moon/ })).toBeInTheDocument();
    await act(async () => { waiting.get('Neon')!({ songs: [song(1, 'Neon Rain')], total: 1, next: null }); });
    await act(async () => { await new Promise((wait) => setTimeout(wait, 50)); });
    expect(screen.queryByRole('option', { name: /Neon Rain/ })).toBeNull();

    // Enter runs what's highlighted for the words in the box now, never the stale Neon Rain
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(close).toHaveBeenCalledOnce();
    const query = new URLSearchParams(window.location.search);
    expect(query.get('q')).toBe('Paper');
    expect(query.get('song')).not.toBe('1');
  });

  it('shows nothing from an answer that arrives after the words changed', async () => {
    let answer: ((body: unknown) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => {
      answer = (body) => done(new Response(JSON.stringify(body), { status: 200 }));
    })));
    render(<CommandPalette commands={[]} onClose={vi.fn()} />);
    const box = screen.getByRole('combobox', { name: 'Search for a page or a command' });
    fireEvent.change(box, { target: { value: 'Neon' } });
    await act(async () => { await new Promise((wait) => setTimeout(wait, 200)); });
    fireEvent.change(box, { target: { value: 'N' } });
    await act(async () => { answer!({ songs: [song(1, 'Neon Rain')], total: 1, next: null }); });
    await act(async () => { await new Promise((wait) => setTimeout(wait, 50)); });
    expect(screen.queryByRole('option', { name: /Neon Rain/ })).toBeNull();
  });
});
