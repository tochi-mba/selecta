import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MixItem } from '../api';
import { setFlags } from '../flags';
import { HORIZON_STOPS, measuredHorizon, MixHorizon } from '../ui/MusicObjects';
import { EditorStory } from './EditorStory';

/** CI-0169-01: one five-stop, start-to-finish horizon in the builder, a draft and the editor. */
const song = (id: number, energy: number | null): MixItem => ({
  id, title: `Song ${id}`, artist: 'Synthetic', energy, seam: null,
} as unknown as MixItem);
const mix = [song(1, 0.2), song(2, 0.4), song(3, 0.9), song(4, 0.6), song(5, 0.3)];

afterEach(() => setFlags(null));

function story(items: MixItem[], scope?: 'current' | 'draft') {
  return render(
    <EditorStory mix={items} keys={items.map((item) => `k${item.id}`)} names={{}} selected={null} playingIndex={-1}
      headingId="story" onSelectSong={() => {}} onEditSong={() => {}} onEditSeam={() => {}} scope={scope} />,
  );
}

describe('CI-0169-01 reusable five-stop horizon', () => {
  it('reads the same five named stops from the real song order, on the mix’s own scale', () => {
    expect([...HORIZON_STOPS]).toEqual(['Start', 'Early', 'Middle', 'Late', 'Finish']);
    expect(measuredHorizon(mix)).toEqual([0, 29, 100, 57, 14]);
    // a gap is unknown, never interpolated; one song has no start-to-finish shape
    expect(measuredHorizon([song(1, 0.2), song(2, null)])).toBeNull();
    expect(measuredHorizon([song(1, 0.2)])).toBeNull();
  });

  it('draws the measured horizon with every stop named, and says it is not a score', () => {
    const { container } = render(<MixHorizon items={mix} scope="current" />);
    expect(container.querySelector('svg.energy-horizon.measured polyline.achieved')).toBeInTheDocument();
    const stops = within(screen.getByRole('list', { name: 'Measured energy at each stop' })).getAllByRole('listitem');
    expect(stops.map((stop) => stop.textContent)).toEqual(['Start 0 out of 100', 'Early 29 out of 100', 'Middle 100 out of 100', 'Late 57 out of 100', 'Finish 14 out of 100']);
    expect(screen.getByText(/It isn’t a score against the shape you asked for/)).toBeInTheDocument();
  });

  it('says so when energy is unknown rather than drawing a guess', () => {
    const { container } = render(<MixHorizon items={[song(1, 0.2), song(2, null)]} scope="draft" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText(/Not every song in this draft has a measured energy yet/)).toBeInTheDocument();
  });

  it('appears in the editor’s Story view for a draft and for the current mix', () => {
    const { container, unmount } = story(mix, 'draft');
    expect(container.querySelector('.mix-horizon[data-scope="draft"] svg.energy-horizon')).toBeInTheDocument();
    expect(screen.getByText(/Measured from this draft’s own songs/)).toBeInTheDocument();
    unmount();
    story(mix);
    expect(screen.getByText(/Measured from this mix’s own songs/)).toBeInTheDocument();
  });

  it('with the flag off the Story view is exactly as before', () => {
    setFlags({ 'editor.energy_horizon': false });
    const { container } = story(mix, 'draft');
    expect(container.querySelector('.mix-horizon')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Song by song' })).toBeInTheDocument();
  });
});
