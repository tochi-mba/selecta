import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeApp } from './RuntimeApp';
import { SetPlayer } from './player';
import { fakeBackend, songs, status } from './test/backend';
import { clearToasts } from './ui/toasts';
import { Library } from './views/Library';

const song = (id: number, title = `Song ${id}`) => ({
  id, artist: 'Someone', title, genre: null, duration: 200, bpm: null, camelot: null,
  lyric_status: null, never: false, priority: false, detected_bpm: null, detected_camelot: null,
  override_bpm: null, override_camelot: null, music_override: null, energy: null, grid_confidence: null,
  readiness: { status: 'queued', reason: 'Waiting to be analysed.' },
});

beforeEach(() => clearToasts());
afterEach(() => vi.useRealTimers());

describe('S4-0111-05: a refresh on the Library', () => {
  it('asks for the first rows alongside the local-or-Cloud check, and reads status only once', async () => {
    window.history.pushState({}, '', '/library?q=gold');
    const asked: string[] = [];
    let answerStatus!: () => void;
    const statusHeld = new Promise<void>((done) => { answerStatus = done; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = url.replace(/^\/api/, '');
      asked.push(path);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path === '/status') { await statusHeld; return json(status()); }
      if (path === '/mix') return json({ mix: songs(), name: 'Test mix', can_undo: false });
      if (path.startsWith('/library?')) return json({ songs: [song(1, 'Gold 1'), song(2, 'Gold 2')], total: 2, next: null });
      if (path === '/jobs') return json({ jobs: [] });
      return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
    }));
    render(<RuntimeApp />);
    // before the server has said whether this is local, the Library's rows are already asked for
    await vi.waitFor(() => expect(asked.some((path) => path.startsWith('/library?'))).toBe(true));
    expect(asked.filter((path) => path === '/status')).toHaveLength(1);
    const early = asked.find((path) => path.startsWith('/library?'))!;
    expect(new URLSearchParams(early.split('?')[1]).get('q')).toBe('gold');
    answerStatus();
    expect(await screen.findByRole('button', { name: 'Details for Gold 2' })).toBeInTheDocument();
    // the app took the check's status and the early rows, rather than asking for either again
    expect(asked.filter((path) => path === '/status')).toHaveLength(1);
    expect(asked.filter((path) => path === early)).toHaveLength(1);
  });
});

describe('S4-0111-05: a search typed on the Library', () => {
  it('is asked for as soon as the typing pauses, with no second wait after it', async () => {
    window.history.pushState({}, '', '/library');
    const calls = fakeBackend({ 'GET /library': { songs: [song(1), song(2, 'Golden 2')], total: 2, next: null } });
    const player = new SetPlayer(() => [], () => {});
    render(
      <Library status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
        refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
        stage={false} toggleStage={() => {}} />,
    );
    expect(await screen.findByRole('button', { name: 'Details for Golden 2' })).toBeInTheDocument();
    vi.useFakeTimers();
    const searched = () => calls.filter((call) => call.path.startsWith('/library?') && call.path.includes('q=golden'));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your library' }), { target: { value: 'golden' } });
    // still typing: nothing asked
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(searched()).toHaveLength(0);
    // the pause after the last key (200 ms) is the only wait; it used to wait another 120 ms
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    expect(searched()).toHaveLength(1);
  });
});
