import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DraftInfo, DraftList } from '../api';
import { setFlags } from '../flags';
import { NowState, SetPlayer } from '../player';
import { fakeBackend, songs } from '../test/backend';
import { MyMixes } from './MyMixes';

/**
 * ADR-0083 (S31-0083-01): My Mixes tells four things apart in words, not by colour or position alone:
 * what plays (the current mix, marked Playing now or Paused), what is saved (each draft says Saved),
 * what is queued (the render line, numbered) and what renders next (the current mix first, then the
 * draft that is 1st in line). The current mix comes first on the page, ahead of
 * the drafts and their render line.
 */

const draft = (id: number, more: Partial<DraftInfo> = {}): DraftInfo => ({
  id, name: `Draft ${id}`, songs: 4, seconds: 800, seams: 3, ready: 1, failed: 0, waiting: 2,
  rendering: false, place: null, eta: null, to_render: 300, missing: 0, ...more,
});

const list = (left: number): DraftList => ({
  drafts: [
    draft(1, { name: 'Rooftop', place: 2, eta: { seconds: 600, low: 500, high: 700 } }),
    draft(2, { name: 'Dawn run', place: 1, rendering: left === 0, eta: { seconds: 300, low: 250, high: 350 } }),
    draft(3, { name: 'Late set', waiting: 0, ready: 3 }),
  ],
  current: { name: 'Friday', songs: 4, left, eta: { seconds: 120, low: 100, high: 140 } },
  out_of_room: false,
});

function show(phase: NowState['phase'], left: number) {
  fakeBackend({ 'GET /drafts': list(left) });
  const mix = songs(null, null, null);
  const player = new SetPlayer(() => mix, () => {});
  return render(
    <MyMixes mix={mix} mixName="Friday" now={{ ...player.state, phase }} player={player} canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}} status={undefined as never}
      stage={false} toggleStage={() => {}} notify={() => {}} openDraft={() => {}} playDraft={async () => {}} setView={() => {}} />,
  );
}

afterEach(() => setFlags(null));

const before = (first: Element, second: Element) => !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('S31-0083-01 what plays, what is saved, what is queued and what renders next', () => {
  it.each([
    ['playing', 'Playing now'],
    ['paused', 'Paused'],
    ['idle', 'Current mix'],
  ] as const)('the current mix says it is the one you hear when %s', async (phase, words) => {
    show(phase, 2);
    const current = screen.getByRole('region', { name: 'Current mix' });
    expect(within(current).getByText(words)).toHaveClass('eyebrow');
    expect(within(current).getByRole('heading', { name: 'Friday' })).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Your drafts' });
  });

  it('every draft says it is saved, and none of them claims to be playing', async () => {
    show('playing', 2);
    const drafts = await screen.findByRole('region', { name: 'Your drafts' });
    const items = drafts.querySelectorAll('li.draft');
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item).toHaveTextContent('Saved.');
      expect(item).not.toHaveTextContent(/Playing now|Paused/);
    }
  });

  it('the render line is numbered, says the current mix goes first, and names what renders next', async () => {
    show('playing', 2);
    const line = await screen.findByRole('region', { name: 'Render line' });
    expect(within(line).getByRole('status')).toHaveTextContent('Your current mix goes first');
    const places = [...line.querySelectorAll('.line-place')].map((place) => place.textContent);
    expect(places).toEqual(['1st in line', '2nd in line']);
    const groups = within(line).getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName('Dawn run in the render line');
    expect(groups[1]).toHaveAccessibleName('Rooftop in the render line');
    // a draft that is ready, or not asked for, is not in the line
    expect(within(line).queryByText('Late set')).toBeNull();
    expect(line).toHaveTextContent('It doesn’t change what’s playing');
  });

  it('once the current mix is done, the 1st in line says it is rendering now', async () => {
    show('playing', 0);
    const line = await screen.findByRole('region', { name: 'Render line' });
    expect(within(line).getByRole('status')).toHaveTextContent('Your current mix is done');
    const drafts = screen.getByRole('region', { name: 'Your drafts' });
    const first = [...drafts.querySelectorAll('li.draft')].find((item) => item.textContent?.includes('Dawn run'))!;
    expect(first).toHaveTextContent('Rendering now');
    expect(first).toHaveTextContent('1st in the render line');
    const ready = [...drafts.querySelectorAll('li.draft')].find((item) => item.textContent?.includes('Late set'))!;
    expect(ready).toHaveTextContent('Ready to play');
    expect(ready).not.toHaveTextContent('in the render line');
  });

  it('what plays comes first, ahead of the drafts and the render line', async () => {
    show('playing', 2);
    const current = screen.getByRole('region', { name: 'Current mix' });
    const drafts = await screen.findByRole('region', { name: 'Your drafts' });
    const line = await screen.findByRole('region', { name: 'Render line' });
    expect(before(current, drafts)).toBe(true);
    expect(before(current, line)).toBe(true);
  });
});
