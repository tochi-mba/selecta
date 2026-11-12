import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LibrarySong } from '../api';
import { fakeBackend, status as appStatus } from '../test/backend';
import { Links } from './Links';
import { SongDetails } from './SongDetails';

// Automated parts of SF-0218-02 and SF-0227-01. The expert review and the detail screen
// critique stay with a person; these only prove the facts each card or sheet carries.

const props = () => ({ setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), status: appStatus(), mix: [], tab: 'words' as const }) as unknown as Parameters<typeof Links>[0];
const link = (a: number, state: Record<string, unknown>) => ({
  phrase: `phrase ${a}`, kind: 'x', a, b: a + 1, artist_a: 'Artist A', title_a: `Opener ${a}`, artist_b: 'Artist B', title_b: `Closer ${a}`,
  line_a: 'a line that ends', line_b: 'a line that starts', moves: ['word_cut'], move: 'word_cut', state: { key: `k${a}`, ...state }, worked: true,
});

describe('SF-0218-02 evidence cards carry pair, technique, limitation and status', () => {
  it('a candidate card names both songs in playing order, its move, its status and that it is only a match to check', async () => {
    fakeBackend({ 'GET /links': { links: [link(1, { status: 'none' })], prepared: 1, preparing: 0 }, 'GET /drafts': { drafts: [] } });
    render(<Links {...props()} />);
    const card = (await screen.findByRole('heading', { name: '“phrase 1”' })).closest('article') as HTMLElement;
    expect(within(card).getByText('Word connection, in playing order')).toBeInTheDocument();
    const [from, into] = Array.from(card.querySelectorAll('.link-handoff'));
    expect(from).toHaveTextContent(/From\s*Opener 1/);
    expect(into).toHaveTextContent(/Into\s*Closer 1/);
    expect(within(card).getByRole('group', { name: 'Which move' })).toBeInTheDocument();
    expect(card.querySelector('.link-status')?.textContent?.trim()).toBeTruthy();
    expect(card.querySelector('.link-evidence')).toHaveAttribute('data-evidence', 'candidate');
    expect(card.querySelector('.link-evidence')).toHaveTextContent(/a match to check/);
  });

  it('a rendered card with a rough spot says so, so the status is not over-trusted', async () => {
    fakeBackend({ 'GET /links': { links: [link(2, { status: 'ready', passed: false, label: 'Word cut' })], prepared: 1, preparing: 0 }, 'GET /drafts': { drafts: [] } });
    render(<Links {...props()} />);
    const card = (await screen.findByRole('heading', { name: '“phrase 2”' })).closest('article') as HTMLElement;
    expect(within(card).getByText(/has a rough spot/)).toBeInTheDocument();
    expect(card.querySelector('.link-evidence')).toHaveAttribute('data-evidence', 'rendered');
    expect(card.querySelector('.link-evidence')).toHaveTextContent(/with a rough spot/);
  });
});

const song = (more: Partial<LibrarySong> = {}): LibrarySong => ({
  id: 9, artist: 'Example Artist', title: 'Example Song', genre: 'pop', duration: 200, bpm: 120, camelot: '8A',
  detected_bpm: 120, detected_camelot: '8A', override_bpm: null, override_camelot: null, music_override: null,
  energy: 0.5, grid_confidence: 0.9, lyric_status: 'synced', never: false, priority: false,
  readiness: { status: 'mix_ready', reason: '' }, ...more,
});

describe('SF-0227-01 core metadata and actions first, diagnostics behind a disclosure', () => {
  it('shows identity, readiness and core facts before the actions, and keeps diagnostics in a closed Advanced section', () => {
    render(<SongDetails song={song()} onClose={() => {}} onChanged={() => {}} notify={() => {}} onPriority={async () => {}} onNever={async () => {}} />);
    const artist = screen.getByText('Example Artist');
    const facts = document.querySelector('.song-facts-table') as HTMLElement;
    const advanced = document.querySelector('details.song-advanced') as HTMLDetailsElement;
    expect(within(facts).getByText('Tempo in use')).toBeInTheDocument();
    expect(within(facts).getByText('Key in use')).toBeInTheDocument();
    expect(advanced.open).toBe(false);
    expect(within(advanced).getByText('Beat grid')).toBeInTheDocument();
    expect(within(facts).queryByText('Beat grid')).toBeNull();
    const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(artist, facts)).toBe(true);
    expect(before(facts, advanced)).toBe(true);
    const actions = screen.getByRole('heading', { name: 'How Selecta treats it' });
    expect(advanced.contains(actions)).toBe(false);
    expect(advanced.querySelectorAll('button')).toHaveLength(0);
  });
});
