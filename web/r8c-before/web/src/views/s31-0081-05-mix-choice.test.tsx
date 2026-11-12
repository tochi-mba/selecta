import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status } from '../test/backend';
import { Mixes } from './Mixes';

/**
 * ADR-0081 (S31-0081-05): the featured pick and each mood card say what Selecta recommends, whose
 * music it draws on and what pressing each button will do, in plain words. Selecta's own wording
 * around them uses no DJ terms, and each card has one main action with the rest quieter.
 */

// DJ words a nontechnical listener shouldn't need. BPM stays: it is printed on the songs themselves.
const DJ_WORDS = /\b(camelot|crossfad\w*|beat-?match\w*|cue points?|stems?|harmonic mix\w*|downbeats?|phras(e|ing)|seams?|EQ|transients?|mixing in key)\b/i;

const card = (key: string, name: string, group: string): VibeCard => ({
  key, name, group, family: null,
  blurb: 'Warm songs for a slow start',
  songs: 40, ready: true, needs: 0,
  artists: ['Ada Lane', 'Bo Reyes'],
  tempo: [100, 124],
  moves: 'Gentle changes between songs',
  seconds: 3900,
});

function show() {
  fakeBackend({ 'GET /vibes': [card('pick', 'Selecta’s pick', ''), card('slow_burn', 'Slow burn', 'The journey')] });
  const player = new SetPlayer(() => [], () => {});
  return render(
    <Mixes
      status={status()} mix={[]} mixName="" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={player.state} setView={() => {}} notify={() => {}}
      stage={false} toggleStage={() => {}}
    />,
  );
}

describe('S31-0081-05 featured mix and mood cards read without DJ terms', () => {
  it('the featured pick: one recommendation, what it draws on, one main action', async () => {
    show();
    const quick = screen.getByRole('region', { name: 'Listen now, shape later' });
    await within(quick).findByText('Selecta’s pick');
    expect(within(quick).getByText('40 matching songs')).toBeInTheDocument();
    expect(within(quick).getByText('Warm songs for a slow start')).toBeInTheDocument();
    const main = quick.querySelectorAll('.primary');
    expect(main).toHaveLength(1);
    expect(main[0]).toHaveTextContent('Play');
    // what Play, editing and saving do is said before anything is pressed
    expect(quick).toHaveTextContent(/Play now/);
    expect(quick.textContent ?? '').not.toMatch(DJ_WORDS);
  });

  it('a mood card: name, plain summary, whose music, outcomes, and one main action', async () => {
    show();
    const article = (await screen.findByRole('heading', { name: 'Slow burn' })).closest('article')!;
    const inside = within(article);
    expect(article.querySelector('.vibe-card-summary')).toHaveTextContent('Warm songs for a slow start');
    fireEvent.click(inside.getByText('Why Slow burn? More details'));
    expect(inside.getByText('Ada Lane, Bo Reyes')).toBeVisible();
    expect(inside.getByText(/Play replaces the current mix after confirmation/)).toBeVisible();
    expect(inside.getByText(/Save draft leaves playback unchanged/)).toBeVisible();

    const actions = article.querySelector('.card-actions')!;
    const buttons = within(actions as HTMLElement).getAllByRole('button');
    expect(buttons.length).toBeLessThanOrEqual(3);
    expect(actions.querySelectorAll('.primary')).toHaveLength(1);
    expect(within(actions as HTMLElement).getByRole('button', { name: 'Play' })).toHaveClass('primary');
    for (const button of buttons.filter((button) => !button.classList.contains('primary'))) expect(button).toHaveClass('quiet');
    expect(article.textContent ?? '').not.toMatch(DJ_WORDS);
  });

  it('the whole Make a Mix page, in Selecta’s own words, uses no DJ terms', async () => {
    const { container } = show();
    await screen.findByRole('heading', { name: 'Slow burn' });
    for (const details of container.querySelectorAll('details')) details.setAttribute('open', '');
    const main = container.querySelector('main')!;
    const found = (main.textContent ?? '').match(new RegExp(DJ_WORDS.source, 'gi')) ?? [];
    expect(found).toEqual([]);
  });
});
