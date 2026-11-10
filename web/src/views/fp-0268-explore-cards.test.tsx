import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

/**
 * ADR-0268: what an Explore card says before and after its disclosure is opened.
 *
 * Default scan surface (decision-critical): name, optional tempo range, optional family scope, one-line
 * summary, two comparable facts (matching songs, length of matching source audio) and the ranked actions
 * (Play filled, Shape first and Save draft quiet). Detail (behind "Why X? More details"): the summary again,
 * the artists drawn from, how it moves, the measured basis and the planning caveat. The section heading
 * carries the shared caveat once, so it is visible before anything is committed.
 */
const card = (key: string, name: string, more: Partial<VibeCard> = {}): VibeCard => ({
  key, name, group: 'The moment', family: null, blurb: `${name} words`, songs: 40, ready: true, needs: 0,
  artists: ['Someone', 'Someone Else'], tempo: [100, 124], moves: 'Vocal rides and long blends', seconds: 3900,
  ...more,
});

function show(mix = songs().slice(0, 0), setMixData = vi.fn(), notify = vi.fn()) {
  const player = new SetPlayer(() => [], () => {});
  vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
  render(
    <Mixes status={status()} mix={mix} mixName={mix.length ? 'Current' : ''} canUndo={false} refreshMix={() => {}}
      setMixData={setMixData} refreshStatus={() => {}} player={player} now={player.state} setView={() => {}}
      notify={notify} stage={false} toggleStage={() => {}} />,
  );
  return { setMixData, notify };
}

/** the text a sighted visitor scans on a closed card: everything outside the closed disclosure */
const scanText = (article: HTMLElement) => {
  const copy = article.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('details > :not(summary)').forEach((node) => node.remove());
  copy.querySelectorAll('svg').forEach((node) => node.remove());
  return copy.textContent!.replace(/\s+/g, ' ').trim();
};

describe('Explore card inventory and default content (FP-0268-01/02)', () => {
  it('a closed card shows only the idea, its comparable facts, the disclosure name and the ranked actions', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time', { basis: ['tempo', 'energy'] })] });
    show();
    const article = (await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!;
    expect(scanText(article)).toBe(
      'Peak time100–124 BPMPeak time words40 matching songsAbout 1 hr 5 min of matching source songsWhy Peak time? More detailsPlayShape firstSave draft',
    );
    const actions = within(article).getAllByRole('button');
    expect(actions.map((button) => button.textContent)).toEqual(['Play', 'Shape first', 'Save draft']);
    expect(actions[0]).toHaveClass('primary');
    expect(actions.slice(1).every((button) => button.classList.contains('quiet'))).toBe(true);
  });
});

describe('comparable facts and missing data (FP-0268-03)', () => {
  it('every card states the same two facts; tempo, artists and basis appear only when they are known', async () => {
    fakeBackend({
      'GET /vibes': [
        card('peak', 'Peak time', { basis: ['tempo'] }),
        card('sparse', 'Sparse idea', { tempo: null, artists: [], basis: undefined, songs: 7, seconds: 1500 }),
      ],
    });
    show();
    const articles = await Promise.all(['Peak time', 'Sparse idea'].map(async (name) => (await screen.findByRole('heading', { name })).closest('article')!));
    for (const article of articles) {
      const facts = article.querySelector('.vibe-card-facts')!;
      expect([...facts.querySelectorAll('span')].map((span) => span.textContent!.replace(/[0-9]+/g, 'N'))).toEqual([
        'N matching songs', expect.stringMatching(/^About .+ of matching source songs$/),
      ]);
    }
    const sparse = within(articles[1]);
    expect(articles[1].querySelector('.vibe-tempo')).toBeNull();
    fireEvent.click(sparse.getByText('Why Sparse idea? More details'));
    // no artist names are invented, and nothing is called measured without a measured basis
    expect(sparse.getByText('your mix-ready songs', { exact: false })).toBeVisible();
    expect(articles[1].textContent).not.toMatch(/measured from your songs/);
    fireEvent.click(within(articles[0]).getByText('Why Peak time? More details'));
    expect(within(articles[0]).getByText(/Chosen by tempo, measured from your songs/)).toBeVisible();
  });
});

describe('one shared caveat, visible before committing (FP-0268-04)', () => {
  it('the section says once that ideas are planning preferences; each card keeps its own caveat in its detail', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time'), card('deep', 'Deep night'), card('warm', 'Warm up')] });
    show();
    const shared = await screen.findByText(/3 available ideas\. These are planning preferences, not previews/);
    expect(shared).toBeVisible();
    expect(shared.closest('details')).toBeNull();
    for (const name of ['Peak time', 'Deep night', 'Warm up']) {
      const article = (await screen.findByRole('heading', { name })).closest('article')!;
      // the repeated per-card caveat is out of the scan surface, but still one named disclosure away
      expect(scanText(article)).not.toMatch(/planning preference|not a promised/i);
      const caveat = within(article).getByText(/Planning preference, not a promised song order/);
      expect(caveat.closest('details')).not.toBeNull();
    }
  });
});

describe('Play, Shape and Save keep their separate consequences, including a failed build (FP-0268-06)', () => {
  it('a build that fails leaves the current mix alone and says so', async () => {
    fakeBackend({
      'GET /vibes': [card('peak', 'Peak time')],
      'POST /vibes/peak/build': new Reply(500, { detail: 'Not enough songs' }),
    });
    const { setMixData } = show(songs());
    const article = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
    fireEvent.click(article.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace and play' }));
    await waitFor(() => expect(article.getByRole('button', { name: 'Play' })).toBeEnabled());
    expect(setMixData).not.toHaveBeenCalled();
  });
});
