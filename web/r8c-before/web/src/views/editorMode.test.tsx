import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { parseEditorMode, storySeamWords } from './editorMode';
import { Mix } from './Mix';

// Flow ADR-0219: Story, Arrange and Detail are three views of one edit model.

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />
  );
}

const ready = (key: string) => seam('ready', key, { label: 'Blend', style: 'bass_swap_blend', a_source_start: 60, b_source_end: 30, preview_seam: 20 });
const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };

describe('SF-0219-01 one shared edit model', () => {
  it('reads every view from the address, and anything unknown is Arrange', () => {
    expect(parseEditorMode('story')).toBe('story');
    expect(parseEditorMode('detail')).toBe('detail');
    expect(parseEditorMode(null)).toBe('arrange');
    expect(parseEditorMode('timeline')).toBe('arrange');
  });

  it('describes a transition in Story only from what the server says, keeping asked and played apart', () => {
    const names = { bass_swap_blend: 'Blend', cut_on_one: 'Cut' };
    expect(storySeamWords(null, names, 'Song 1').headline).toBe('No transition');
    expect(storySeamWords(seam('none', 'a'), names, 'Song 1')).toMatchObject({ kind: 'planned', headline: 'Not rendered yet' });
    expect(storySeamWords(seam('failed', 'a'), names, 'Song 1')).toMatchObject({ kind: 'failed', headline: 'Couldn’t be made' });
    const fell = storySeamWords(seam('ready', 'a', { label: 'Cut', style: 'cut_on_one', fell_back: true }), names, 'Song 1');
    expect(fell.kind).toBe('warning');
    expect(fell.headline).toBe('Fell back to Cut');
    expect(fell.detail).toContain('You chose Blend');
  });

  it('keys Story chapters and seams by the same occurrence keys as the Arrange timeline', () => {
    fakeBackend({});
    window.history.pushState({}, '', '/mix/current/edit?view=story');
    const { container } = render(<Harness start={songs(ready('a'), ready('b'))} />);
    const storyKeys = Array.from(container.querySelectorAll('[data-story-song]')).map((node) => node.getAttribute('data-story-song'));
    const seamKeys = Array.from(container.querySelectorAll('[data-story-seam]')).map((node) => node.getAttribute('data-story-seam'));
    expect(storyKeys).toHaveLength(3);
    expect(new Set(storyKeys).size).toBe(3);
    expect(seamKeys).toEqual([`${storyKeys[0]}>${storyKeys[1]}`, `${storyKeys[1]}>${storyKeys[2]}`]);
  });
});

describe('SF-0219-05 switching views keeps the selection, the scope and the mix', () => {
  beforeEach(() => window.history.pushState({}, '', '/mix/current/edit?view=story'));

  it('carries a selected transition from Story to Detail to Story to Arrange, sending nothing', async () => {
    const calls = fakeBackend({ 'GET /mix/2/options': options, 'GET /mix/1/options': options });
    const { container } = render(<Harness start={songs(ready('a'), ready('b'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit this transition: Song 2 into Song 3' }));
    expect(window.location.search).toContain('view=detail');
    const side = await screen.findByRole('complementary', { name: 'This transition' });
    expect(within(side).getAllByText('Song 2').length).toBeGreaterThan(0);
    expect(within(side).getAllByText('Song 3').length).toBeGreaterThan(0);
    expect(within(side).queryByText('Song 1')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'Story' }));
    await waitFor(() => expect(window.location.search).toContain('view=story'));
    const selectedSeam = container.querySelector('.story-seam[aria-current="true"]');
    expect(selectedSeam).toHaveTextContent('From Song 2 into Song 3');

    await userEvent.click(screen.getByRole('radio', { name: 'Arrange' }));
    await waitFor(() => expect(window.location.search).not.toContain('view='));
    const arranged = await screen.findByRole('complementary', { name: 'This transition' });
    expect(within(arranged).getAllByText('Song 3').length).toBeGreaterThan(0);
    expect(within(arranged).queryByText('Song 1')).toBeNull();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });
});
