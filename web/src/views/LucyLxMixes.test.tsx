import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

/*
 * Selecta Library + Lucy programme (LX), ADR-0354: Make a Mix's feelings as a way into creating a mix.
 * The card hierarchy, honest facts, three distinct actions, source-length wording, sparse ideas and the
 * folded-away detail. The Lucy handoff (LX-0354-05) is proven in a real browser in e2e/lx-lucy.e2e.ts.
 */
const card = (key: string, name: string, more: Partial<VibeCard> = {}): VibeCard => ({
  key, name, group: 'The moment', family: null, blurb: `${name} words`, songs: 40, ready: true, needs: 0,
  artists: ['Someone'], tempo: [100, 124], moves: 'Long blends', seconds: 3900, ...more,
});

function show(mix = songs().slice(0, 0)) {
  const player = new SetPlayer(() => [], () => {});
  vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
  render(
    <Mixes status={status()} mix={mix} mixName={mix.length ? 'Current' : ''} canUndo={false} refreshMix={() => {}}
      setMixData={vi.fn()} refreshStatus={() => {}} player={player} now={player.state} setView={() => {}}
      notify={vi.fn()} stage={false} toggleStage={() => {}} />,
  );
}

const article = async (name: string) => (await screen.findByRole('heading', { name })).closest('article')!;

describe('LX-0354 feelings as a way into a mix', () => {
  it('LX-0354-01 a card reads name, feeling, real facts, then one filled action', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time')] });
    show();
    const found = await article('Peak time');
    const order = [...found.querySelectorAll('h3, .vibe-card-summary, .vibe-card-facts, .card-actions')].map((node) => node.className || node.tagName);
    expect(order).toEqual(['H3', 'vibe-card-summary', 'vibe-card-facts', 'row card-actions']);
    expect(found.querySelectorAll('.card-actions .primary')).toHaveLength(1);
    expect(within(found).getAllByRole('button')[0]).toHaveTextContent('Play');
  });

  it('LX-0354-02 and -04 the facts are matching songs and source length, never a mix length or ready transitions', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time')] });
    show();
    const found = await article('Peak time');
    const facts = found.querySelector('.vibe-card-facts')!;
    expect(facts.textContent).toMatch(/40 matching songs/);
    expect(facts.textContent).toMatch(/About 1 hr 5 min of matching source songs/);
    expect(found.textContent).not.toMatch(/full mix|mix length|ready transitions|transitions ready|runtime/i);
    // the length is called approximate source material, and the shared caveat says ideas are not previews
    expect(screen.getByText(/planning preferences, not previews/)).toBeVisible();
  });

  it('LX-0354-03 Play, Shape first and Save draft each say what they do', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time')] });
    show();
    const found = await article('Peak time');
    for (const name of ['Play', 'Shape first', 'Save Peak time as a draft']) {
      expect(within(found).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(found).getAllByRole('button')).toHaveLength(3);
    const caveat = within(found).getByText(/Play replaces the current mix after confirmation/).textContent!;
    expect(caveat).toMatch(/Shape first opens the new mix for editing/);
    expect(caveat).toMatch(/Save draft leaves playback unchanged/);
  });

  it('LX-0354-06 an idea without enough songs says why and offers a supported next step', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time'), card('sparse', 'Sparse idea', { ready: false, needs: 6, songs: 2 })] });
    show();
    await article('Peak time');
    const waiting = screen.getByRole('heading', { name: 'Needs more mix-ready songs' }).closest('section')!;
    expect(within(waiting).getByText('Sparse idea')).toBeVisible();
    expect(within(waiting).getByText('needs 6 more')).toBeVisible();
    expect(waiting.textContent).toMatch(/try another available idea, or analyse more local songs/);
    expect(waiting.textContent).toMatch(/No new mix will be made from an unavailable idea/);
    expect(within(waiting).queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('LX-0354-07 the extra detail and the Lucy handoff stay folded away until asked for', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time', { basis: ['tempo'] })] });
    show();
    const found = await article('Peak time');
    const detail = found.querySelector('details')!;
    expect(detail.open).toBe(false);
    const lucy = within(found).getByText('Use this feeling with Lucy');
    expect(lucy.closest('details')).toBe(detail);
    fireEvent.click(within(found).getByText('Why Peak time? More details'));
    expect(detail.open).toBe(true);
    expect(within(found).getByText(/it does not send a request/)).toBeVisible();
  });
});
