import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Mixes } from './Mixes';

// EX-0118-03: a card only states what the server measured. Missing artists or tempo are
// left out or named honestly, an idea without enough ready songs offers no Play, and
// length is only ever "about".

const base: VibeCard = {
  key: 'night', name: 'Night drive', group: 'The moment', family: null, blurb: 'Night words', songs: 18, ready: true,
  needs: 0, artists: [], tempo: null, moves: 'Long blends', seconds: 3600,
};

function show(cards: VibeCard[]) {
  fakeBackend({ 'GET /vibes': cards });
  const player = new SetPlayer(() => [], () => {});
  render(
    <Mixes status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}} />,
  );
}

describe('EX-0118-03 partial and unknown metadata', () => {
  it('no artists and no tempo: invents neither', async () => {
    show([base]);
    const article = within((await screen.findByRole('heading', { name: 'Night drive' })).closest('article')!);
    expect(article.queryByText(/BPM/)).toBeNull();
    expect(article.getByText(/your mix-ready songs/)).toBeInTheDocument();
    expect(article.getByText(/About .* of matching source songs/)).toBeInTheDocument();
    expect(article.getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('an idea that is not ready is listed with what it needs, and offers no Play', async () => {
    show([base, { ...base, key: 'rap', name: 'Rap run', ready: false, needs: 4 }]);
    await screen.findByRole('heading', { name: 'Night drive' });
    expect(screen.queryByRole('heading', { name: 'Rap run' })).toBeNull();
    const waiting = screen.getByRole('heading', { name: 'Needs more mix-ready songs' }).closest('section')!;
    expect(within(waiting).getByText('needs 4 more')).toBeInTheDocument();
    expect(within(waiting).queryByRole('button')).toBeNull();
    expect(within(waiting).getByText(/No new mix will be made from an unavailable idea/)).toBeInTheDocument();
  });
});

// EX-0118-04: an idea is not a rendered mix yet, so there is no exact audio and revision
// to preview. The gate rejects card previews: no card offers sound, and the page says so.
describe('EX-0118-04 preview feasibility gate', () => {
  it('cards offer no audio preview and call themselves planning preferences, not previews', async () => {
    show([base, { ...base, key: 'peak', name: 'Peak time' }]);
    await screen.findByRole('heading', { name: 'Night drive' });
    for (const name of ['Night drive', 'Peak time']) {
      const article = within(screen.getByRole('heading', { name }).closest('article')!);
      expect(article.queryByRole('button', { name: /preview|hear|listen|audition/i })).toBeNull();
    }
    expect(document.querySelector('audio')).toBeNull();
    expect(screen.getByText(/planning preferences, not previews/)).toBeInTheDocument();
  });
});
