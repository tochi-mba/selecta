import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Library } from './Library';

/**
 * S4-0105-10: advanced tempo, key and genre filters are not approved, so the Library must present
 * none of them as available. Tempo stays a sort only. An address asking for an unsupported filter
 * (`?show=genre`) shows everything and names no such filter.
 */
const row = (id: number, title: string) => ({
  id, artist: 'Someone', title, genre: 'House', duration: 200, bpm: 124, camelot: '8A', lyric_status: null,
  never: false, priority: false, detected_bpm: 124, detected_camelot: '8A', override_bpm: null, override_camelot: null,
  music_override: null, energy: null, grid_confidence: null, readiness: { status: 'ready', reason: '' },
});

function show() {
  const player = new SetPlayer(() => [], () => {});
  render(
    <Library status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

describe('S4-0105-10 no unsupported analysis filter', () => {
  it('offers only the supported state filters, and tempo only as a sort', async () => {
    window.history.pushState({}, '', '/library');
    fakeBackend({ 'GET /library': { songs: [row(1, 'First')], total: 1, next: null } });
    show();
    const group = await screen.findByRole('group', { name: 'Filter Library recordings' });
    const labels = within(group).getAllByRole('button').map((button) => button.textContent);
    expect(labels).toEqual(['Everything', 'Ready', 'Not analysed yet', 'Needs attention', 'Priority list', 'Set aside']);
    for (const label of labels) expect(label).not.toMatch(/tempo|bpm|key|genre|camelot/i);
    expect(screen.queryByRole('combobox', { name: /genre|key|bpm|tempo range/i })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('an address asking for a genre, key or tempo filter shows everything and claims no such filter', async () => {
    for (const unsupported of ['genre', 'key', 'tempo']) {
      window.history.pushState({}, '', `/library?show=${unsupported}`);
      const calls = fakeBackend({ 'GET /library': { songs: [], total: 0, next: null } });
      show();
      const group = await screen.findByRole('group', { name: 'Filter Library recordings' });
      expect(within(group).getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(group).queryByRole('button', { name: 'Clear all filters' })).toBeNull();
      await waitFor(() => expect(calls.some((call) => call.path.startsWith('/library'))).toBe(true));
      for (const call of calls.filter((item) => item.path.startsWith('/library'))) expect(call.path).toContain('state=all');
      expect(document.body.textContent).not.toMatch(new RegExp(`Looking in: ${unsupported}`));
      cleanup();
    }
  });
});
