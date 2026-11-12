import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { setPrefs } from '../state/prefs';
import { fakeBackend, status } from '../test/backend';
import { Now } from './Now';
import { SPECTRUM_MODES } from './spectrumVisuals';

// Flow ADR-0211/0212/0213: the automatable parts of SF-0211-07 (still and written hand-off
// equivalents), SF-0212-07 (every visualizer style named and described), SF-0213-06 (RTL and long
// lyric lines) and SF-0213-08 (reduced motion keeps the lyric meaning). The NVDA sessions, comfort
// review, Unicode snapshot review and reading study stay with a person.

const song = (id: number, seam: MixItem['seam'] = null): MixItem => ({
  position: id - 1, song_id: id, artist: `Artist ${id}`, title: `Song ${id}`, duration: 20,
  bpm: 120, key: '8A', locked: false, seam,
});

const detail: SongDetail = {
  id: 1, artist: 'Artist 1', title: 'Song 1', duration: 20, bpm: 120, key: '8A',
  peaks: [], bar_times: [0, 8, 16], beat_times: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18], beats_per_bar: 4,
  sections: [], lines: [],
};

function show(mix: MixItem[], now: Partial<SetPlayer['state']>, stage = false) {
  const player = new SetPlayer(() => mix, () => {});
  const view = render(
    <Now status={status()} mix={mix} mixName="Test mix" canUndo={false}
      refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
      player={player} now={{ ...player.state, phase: 'playing', position: 0, duration: 20, ...now }}
      setView={() => {}} notify={() => {}} stage={stage} toggleStage={() => {}} />,
  );
  return { ...view, player };
}

const seamed = () => [
  song(1),
  song(2, { settings: { move: 'blend' }, state: { status: 'ready', key: 'k', style: 'blend', switch_at: 4 } }),
];

afterEach(() => {
  window.localStorage.clear();
  setPrefs({ motion: 'subtle' });
});

describe('SF-0211-07 the hand-off is written out, with or without motion', () => {
  it('while it plays, a still page names the region, both songs and what is happening in words', async () => {
    setPrefs({ motion: 'still' });
    fakeBackend({ 'GET /songs/1': detail });
    show(seamed(), { songTime: 12, seamAt: 10, inSeam: true, nextReady: true }, true);
    const region = await screen.findByRole('region', { name: 'Transition into Song 2 is playing' });
    expect(within(region).getByText('Transition in progress')).toBeInTheDocument();
    expect(region.querySelector('.handoff-pair')).toHaveTextContent('From Song 1Into Song 2');
    expect(within(region).getByText('The next song is entering')).toBeInTheDocument();
    // the progress fill is decoration over the words, never the only carrier of meaning
    expect(region.querySelector('.handoff-progress')?.textContent ?? '').toBe('');
  });

  it('before it starts, the wait is said in words, and in minutes and seconds without a beat grid', async () => {
    setPrefs({ motion: 'still' });
    fakeBackend({ 'GET /songs/1': { ...detail, bar_times: [], beat_times: [] } });
    show(seamed(), { songTime: 2, seamAt: 10, inSeam: false, nextReady: true }, true);
    const region = await screen.findByRole('region', { name: 'Time to the next transition' });
    expect(region).toHaveTextContent('0:08 until the hand-off');
    expect(region).toHaveTextContent('Beat grid unavailable, so time is shown in minutes and seconds.');
  });
});

describe('SF-0212-07 every visualizer style has a name, a description and a named canvas', () => {
  it('lists all fifteen styles by name, describes the chosen one, and names the canvas after it', async () => {
    window.localStorage.removeItem('selecta.listen');
    fakeBackend({ 'GET /songs/1': detail });
    const { player } = show([song(1)], { songTime: 2 });
    const select = await screen.findByRole('combobox', { name: 'Audio visualizer style' });
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(SPECTRUM_MODES.map((mode) => mode.label));
    for (const mode of SPECTRUM_MODES) {
      fireEvent.change(select, { target: { value: mode.id } });
      expect(screen.getByText(mode.description)).toBeInTheDocument();
      expect(screen.getByRole('img', { name: `${mode.label} - actual mixed-audio frequency levels` })).toBeInTheDocument();
    }
    // choosing a style never touches the sound
    expect(player.state.phase).toBe('idle');
  });
});

describe('SF-0213-06 RTL and long lyric lines keep their direction and every word', () => {
  const long = 'This line keeps going on and on with words that a narrow screen must wrap rather than cut off at the edge';
  const lines = [
    { start: 0, end: 3, text: 'שלום עולם, זה שיר' },
    { start: 3, end: 6, text: 'مرحبا بالعالم هذه أغنية' },
    { start: 6, end: 9, text: long },
  ];

  it('marks each line dir=auto and never shortens the text, on the page and on the Stage', async () => {
    for (const stage of [false, true]) {
      fakeBackend({ 'GET /songs/1': { ...detail, lines } });
      const { unmount, container } = show([song(1)], { songTime: 4 }, stage);
      await waitFor(() => expect(container.querySelector('.lyrics p.sung')).toHaveTextContent('مرحبا بالعالم هذه أغنية'));
      const shown = [...container.querySelectorAll('.lyrics p:not(.lyric-confidence)')].filter((p) => p.textContent?.trim());
      expect(shown.length).toBeGreaterThanOrEqual(3);
      for (const line of shown) expect(line).toHaveAttribute('dir', 'auto');
      for (const text of lines.map((line) => line.text)) {
        expect(shown.some((line) => line.textContent === text)).toBe(true);
      }
      unmount();
    }
  });
});

describe('SF-0213-08 reduced motion keeps what the moving lyrics mean', () => {
  it('still marks the line being sung, says how it is timed, and offers the whole sheet to read', async () => {
    setPrefs({ motion: 'still' });
    const lines = [
      { start: 0, end: 3, text: 'First line here' },
      { start: 3, end: 6, text: 'Second line here' },
      { start: 6, end: 9, text: 'Third line here' },
    ];
    fakeBackend({ 'GET /songs/1': { ...detail, lines, lyric_status: 'synced' } });
    const { container } = show([song(1)], { songTime: 4 });
    await waitFor(() => expect(container.querySelector('.lyrics p.sung')).toHaveTextContent('Second line here'));
    expect(screen.getByText(/Line-timed lyrics|Word highlights follow/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read all lyrics' }));
    const sheet = screen.getByRole('region', { name: 'All timed lyrics, scroll manually' });
    expect(within(sheet).getByText('First line here')).toBeInTheDocument();
    expect(within(sheet).getByText('Third line here')).toBeInTheDocument();
    expect(within(sheet).getByText('Second line here')).toHaveClass('sung');
  });
});
