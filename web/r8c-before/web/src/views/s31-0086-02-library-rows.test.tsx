import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

/**
 * ADR-0086 (S31-0086-02): scanning a Library row meets the song first (title, then artist), then its
 * plain facts, then whether it can go in a mix and why not, and only then the actions; upkeep such as
 * Prioritize and Never play waits behind the row's own menu. The order holds in the reading order and
 * in the grid at desktop, tablet and phone widths.
 */

const row = (id: number, title: string, readiness: { status: string; reason: string }, bpm: number | null = null) => ({
  id, artist: `Artist ${id}`, title, genre: null, duration: 200, bpm, camelot: bpm ? '8A' : null, lyric_status: null,
  never: false, priority: false, detected_bpm: null, detected_camelot: null, override_bpm: null, override_camelot: null,
  music_override: null, energy: null, grid_confidence: null, readiness,
});

beforeEach(() => window.history.pushState({}, '', '/library'));

function show() {
  fakeBackend({ 'GET /library': { songs: [
    row(1, 'Ready one', { status: 'mix_ready', reason: '' }, 120),
    row(2, 'Blocked one', { status: 'needs_attention', reason: 'Audio file is missing.' }),
  ], total: 2, next: null } });
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}} />,
  );
}

const before = (first: Element, second: Element) => !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const operations = (node.getBuiltinModule('node:fs') as Fs).readFileSync(`${node.cwd()}/src/styles/operations.css`, 'utf8');

describe('S31-0086-02 a Library row reads song, facts, readiness, then actions', () => {
  it('each row reads title, artist, facts, readiness, actions, in that order', async () => {
    show();
    await screen.findByText('Blocked one');
    for (const item of document.querySelectorAll<HTMLElement>('ul.library-rows > li.song-row')) {
      const title = item.querySelector('.song-open b')!;
      const artist = item.querySelector('.song-name > span[dir="auto"]')!;
      const facts = item.querySelector('.song-columns')!;
      const readiness = item.querySelector('.song-readiness')!;
      const actions = item.querySelector('.song-actions')!;
      expect(before(title, artist)).toBe(true);
      expect(before(artist, facts)).toBe(true);
      expect(before(facts, readiness)).toBe(true);
      expect(before(readiness, actions)).toBe(true);
      expect(title.closest('button')).toHaveAccessibleName(/^Details for /);
    }
  });

  it('a blocked song says why next to its status, before any action', async () => {
    show();
    const blocked = (await screen.findByText('Blocked one')).closest('li')!;
    const why = within(blocked).getByText('Audio file is missing.');
    expect(why.closest('.song-readiness')).not.toBeNull();
    expect(blocked.querySelector('.song-readiness .status')).not.toBeNull();
    expect(within(blocked).queryByRole('button', { name: 'Start a mix' })).toBeNull();
  });

  it('upkeep waits behind the row’s menu; the one main action for a ready song is in view', async () => {
    show();
    const ready = (await screen.findByText('Ready one')).closest('li')!;
    expect(within(ready).getByRole('button', { name: 'Start a mix' })).toBeInTheDocument();
    expect(within(ready).queryByRole('menuitemcheckbox', { name: /Prioritize|Never play/ })).toBeNull();
    fireEvent.click(within(ready).getByRole('button', { name: 'More actions for Ready one' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Prioritize' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Never play' })).toBeInTheDocument();
  });

  it('the grid keeps the same order at desktop, tablet and phone widths', () => {
    const areas = [...operations.matchAll(/\.library-rows \.song-row \{[^}]*grid-template-areas:\s*([^;]+);/g)].map((match) => match[1].replace(/['\s]+/g, ' ').trim());
    expect(areas).toEqual([
      'name facts readiness actions',
      'name actions facts actions readiness actions',
      'name facts readiness actions',
    ]);
    // the song's name is placed by name, not by where it happens to fall
    expect(operations).toMatch(/\.library-rows \.song-name \{ grid-area: name; \}/);
  });
});
