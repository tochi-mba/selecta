import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { songs, status } from './test/backend';
import { clearToasts } from './ui/toasts';

const song = (id: number) => ({
  id, artist: 'Someone', title: `Song ${id}`, genre: null, duration: 200, bpm: null, camelot: null,
  lyric_status: null, never: false, priority: false, detected_bpm: null, detected_camelot: null,
  override_bpm: null, override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
});

beforeEach(() => clearToasts());

describe('MI-0162-04: opening the app on the Library', () => {
  it('asks for the first rows alongside status and the mix, and uses that one answer', async () => {
    window.history.pushState({}, '', '/library?q=gold&show=ready');
    const asked: string[] = [];
    let answerStatus!: () => void;
    const statusHeld = new Promise<void>((done) => { answerStatus = done; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = url.replace(/^\/api/, '');
      asked.push(path);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path === '/status') { await statusHeld; return json(status()); }
      if (path === '/mix') return json({ mix: songs(), name: 'Test mix', can_undo: false });
      if (path.startsWith('/library?')) return json({ songs: [song(1), song(2)], total: 2, next: null });
      if (path === '/jobs') return json({ jobs: [] });
      return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
    }));
    render(<App />);
    // the Library's own request is already out while status is still unanswered
    await vi.waitFor(() => expect(asked.some((path) => path.startsWith('/library?'))).toBe(true));
    const early = asked.find((path) => path.startsWith('/library?'))!;
    expect(new URLSearchParams(early.split('?')[1]).get('q')).toBe('gold');
    expect(new URLSearchParams(early.split('?')[1]).get('state')).toBe('ready');
    expect(asked.indexOf(early)).toBeLessThanOrEqual(asked.indexOf('/status') + 1);
    answerStatus();
    expect(await screen.findByRole('button', { name: 'Details for Song 2' })).toBeInTheDocument();
    // the page used the early answer rather than asking again
    expect(asked.filter((path) => path === early)).toHaveLength(1);
  });
});
