import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, songs, status } from '../test/backend';
import { Now } from '../views/Now';

/** SF-0209-02: the desktop transport on Listen. The song's identity (title and artist) is one group
 * with the full name in it, and Previous, Play/Pause and Next are one named group whose single primary
 * is Play/Pause. Geometry at wide and shallow sizes is measured in web/e2e/sf0209-desktop-transport.e2e.ts. */

const longTitle = 'A Very Long Song Title That Would Never Fit On One Narrow Line (Extended Club Remix)';
const detail = { id: 1, artist: 'Artist 1', title: longTitle, duration: 200, bpm: 120, key: '8A', peaks: [], sections: [], lines: [], bar_times: [], beat_times: [], beats_per_bar: 4 } as unknown as SongDetail;

function listen(phase: 'playing' | 'paused' = 'playing') {
  const mix = songs().map((song, index) => (index === 0 ? { ...song, title: longTitle, artist: 'Artist 1' } : song)) as MixItem[];
  fakeBackend({ 'GET /status': status(), 'GET /songs/1': detail });
  const player = new SetPlayer(() => mix, () => {});
  render(
    <Now status={status()} mix={mix} mixName="Mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase, position: 0, songTime: 4, duration: 200, nextReady: false, seamAt: null }}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

describe('SF-0209-02 desktop transport', () => {
  it('title and artist sit together in one identity group with the full name', () => {
    listen();
    const title = screen.getByRole('heading', { level: 1 });
    const identity = title.closest('header')!;
    expect(identity).toHaveClass('listen-identity');
    expect(title).toHaveTextContent(longTitle);
    expect(within(identity).getByText('Artist 1')).toBeInTheDocument();
    // the transport is not inside the identity, and follows it
    const controls = screen.getByRole('group', { name: 'Song controls' });
    expect(identity.contains(controls)).toBe(false);
    expect(identity.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Previous, Play/Pause and Next form one named group in that order, with one primary', () => {
    for (const phase of ['playing', 'paused'] as const) {
      listen(phase);
      const controls = screen.getAllByRole('group', { name: 'Song controls' }).at(-1)!;
      const buttons = within(controls).getAllByRole('button');
      expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
        'Previous song', phase === 'playing' ? 'Pause' : 'Resume', 'Next song',
      ]);
      const primaries = controls.querySelectorAll('.primary');
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toBe(buttons[1]);
      expect(buttons[1]).toHaveClass('big');
      for (const button of [buttons[0], buttons[2]]) expect(button).not.toHaveClass('primary');
    }
  });

  it('the stylesheet keeps the group on one row with 44px targets and a wider primary', () => {
    const css = readFileSync(resolve(__dirname, '../styles/listening.css'), 'utf8');
    expect(css).toMatch(/\.now \.transport \{[^}]*flex-wrap: nowrap/);
    expect(css).toMatch(/\.now \.transport button \{[^}]*min-width: 44px;[^}]*min-height: 44px/);
    expect(css).toMatch(/\.now \.transport \.primary\.big \{[^}]*min-width: 160px/);
  });
});
