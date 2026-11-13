import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { setFlags } from '../flags';
import { SetPlayer } from '../player';
import { fakeBackend, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

// SF-0217-06: the Listening Compass (the optional "Shape this mix" controls) never stands between an
// idea and Play. The findability task with people stays with a person.

const card: VibeCard = {
  key: 'peak', name: 'Peak time', group: 'The moment', family: null, blurb: 'Peak words', songs: 40, ready: true,
  needs: 0, artists: ['Someone'], tempo: [100, 124], moves: 'Long blends', seconds: 3900,
};

function show() {
  const calls = fakeBackend({
    'GET /vibes': [card],
    'POST /vibes/peak/build': { mix: songs(), name: 'Peak time', can_undo: true, count: 12 },
  });
  const player = new SetPlayer(() => [], () => {});
  vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
  const setMixData = vi.fn();
  render(
    <Mixes status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}}
      setMixData={setMixData} refreshStatus={() => {}} player={player} now={player.state} setView={() => {}}
      notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
  return { calls, setMixData };
}

const builds = (calls: { method: string; path: string }[]) => calls.filter((call) => call.method === 'POST' && call.path.includes('/vibes/peak/build'));
const compassOpen = () => !!screen.queryByRole('region', { name: 'Mix controls' })
  || !!screen.queryByRole('region', { name: 'Energy arc controls' })
  || !!screen.queryByRole('region', { name: 'Mix destination' });

afterEach(() => { setFlags(null); window.localStorage.clear(); });

describe('SF-0217-06 the Compass stays optional and Play stays direct', () => {
  it('the Compass starts closed and says it is optional; Play is the first, filled action on the idea', async () => {
    show();
    const article = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
    expect(screen.getByRole('button', { name: 'Customize: Shape this mix (optional)' })).toBeInTheDocument();
    expect(compassOpen()).toBe(false);
    const actions = article.getAllByRole('button');
    expect(actions[0]).toHaveAccessibleName('Play');
    expect(actions[0]).toHaveClass('primary');
  });

  it('Play builds and plays in one press without opening the Compass', async () => {
    const { calls, setMixData } = show();
    const article = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
    fireEvent.click(article.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(builds(calls)).toHaveLength(1));
    await waitFor(() => expect(setMixData).toHaveBeenCalledOnce());
    expect(compassOpen()).toBe(false);
  });

  it('with the Compass switched off, the page reflows and Play still works', async () => {
    setFlags({ 'mixes.shaping': false });
    const { calls } = show();
    const article = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
    expect(screen.queryByRole('button', { name: 'Customize: Shape this mix (optional)' })).toBeNull();
    fireEvent.click(article.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(builds(calls)).toHaveLength(1));
  });
});
