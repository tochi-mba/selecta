import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/**
 * S4-0101-08: in the transition inspector a rating always belongs to the rendered version whose clip
 * is on screen. After the transition is rendered again, a press rates the new version (by its key),
 * the old version's rating is not shown as this one's, and a render that is not finished offers no
 * rating at all.
 */
let player = new SetPlayer(() => [], () => {});
function View({ mix }: { mix: MixItem[] }) {
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}} />
  );
}

const ready = (key: string, rating?: string) => songs(seam('ready', key, { duration: 30, a_source_start: 100, b_source_end: 10, ...(rating ? { rating } : {}) }));

describe('S4-0101-08 rating follows the rendered version', () => {
  beforeEach(() => { player = new SetPlayer(() => [], () => {}); });
  it('a rating after a new render goes to the new key, and the old rating is not carried over', async () => {
    const calls = fakeBackend({ 'POST /seams/first-render/rate': {}, 'POST /seams/second-render/rate': {} });
    const { rerender } = render(<View mix={ready('first-render', 'good')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const side = () => within(screen.getByRole('complementary', { name: 'This transition' }));
    fireEvent.click(side().getByRole('tab', { name: 'Listen' }));
    const group = () => within(side().getByRole('group', { name: 'Rate this seam' }));
    expect(group().getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('audio')?.getAttribute('src')).toContain('/seams/first-render/preview');

    // rendered again with new settings: a different version, with no rating of its own yet
    rerender(<View mix={ready('second-render')} />);
    expect(group().getByRole('button', { name: 'Good' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('audio')?.getAttribute('src')).toContain('/seams/second-render/preview');
    fireEvent.click(group().getByRole('button', { name: 'Bad' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/seams/second-render/rate')).toBe(true));
    expect(calls.find((call) => call.path === '/seams/second-render/rate')?.body).toEqual({ rating: 'bad' });
    expect(calls.some((call) => call.path === '/seams/first-render/rate')).toBe(false);
  });

  it('while the new version is still rendering there is nothing to rate', () => {
    fakeBackend({});
    const { rerender } = render(<View mix={ready('first-render', 'good')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Listen' }));
    expect(screen.getAllByRole('group', { name: 'Rate this seam' }).length).toBeGreaterThan(0);
    rerender(<View mix={songs(seam('rendering', 'second-render'))} />);
    expect(screen.queryAllByRole('group', { name: 'Rate this seam' })).toHaveLength(0);
    rerender(<View mix={songs(seam('queued', 'second-render'))} />);
    expect(screen.queryAllByRole('group', { name: 'Rate this seam' })).toHaveLength(0);
  });
});
