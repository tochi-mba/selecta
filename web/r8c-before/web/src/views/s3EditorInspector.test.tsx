// S3-0057-07 and S3-0058-06: a request on its way never looks playable in the timeline, and the
// Details tab keeps its audit order: what plays, what was chosen, the music, what else was tried,
// then the quality checks.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';
import { RequestsContext, RequestsState } from './Requests';

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const refs = { mix };
  const player = new SetPlayer(() => refs.mix, () => {});
  return (
    <Mix
      status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player}
      now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}}
    />
  );
}

const requests = (list: unknown[]) => ({
  requests: list, error: '', message: '',
  add: async () => {}, cancel: async () => {}, chooseBridge: async () => {}, addAnyway: async () => {},
}) as unknown as RequestsState;

describe('a request on its way, in the Edit timeline', () => {
  it('has no play, move, lock or remove control, and says it cannot play yet', () => {
    const start = songs(seam('ready', 'a'), seam('ready', 'b'));
    const player = new SetPlayer(() => start, () => {});
    (player as unknown as { state: { phase: string } }).state.phase = 'playing';
    const coming = { id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, stage: 'preparing', after_id: 2 };
    const { container } = render(
      <RequestsContext.Provider value={{ ...requests([coming]), playback: { mix: start, player, onMix: () => {} } }}>
        <Harness start={start} />
      </RequestsContext.Provider>,
    );
    const ghost = container.querySelector('li.song.coming') as HTMLElement;
    expect(ghost).toHaveTextContent('Wanted');
    expect(ghost).toHaveTextContent('Not playable yet');
    expect(ghost.getAttribute('aria-label')).toMatch(/won’t play until it’s ready/);
    expect(within(ghost).queryAllByRole('button')).toHaveLength(0);
    // the real songs keep their controls
    const real = [...container.querySelectorAll('ol.timeline li.song:not(.coming)')];
    expect(real).toHaveLength(3);
    expect(real.every((row) => row.querySelector('button'))).toBe(true);
  });
});

describe('the Details tab', () => {
  it('keeps the audit order: what plays, what you chose, the music, what else was tried, quality checks', async () => {
    const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };
    fakeBackend({ 'GET /mix/1/options': options });
    const audited = {
      settings: { move: 'vocal_ride' },
      state: {
        status: 'ready' as const, key: 'a', passed: true, label: 'Blend', style: 'bass_swap_blend', fell_back: true,
        why: 'Close in tempo', a_source_start: 60, b_source_end: 30, preview_seam: 20,
        tried: [{ move: 'vocal_ride', why: 'No safe vocal runway' }],
        checks: [{ name: 'beat', passed: true, text: 'The beats line up', value: '' }],
      },
    };
    render(<Harness start={songs(audited as never)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    const side = within(screen.getByRole('complementary', { name: 'This transition' }));
    await userEvent.click(side.getByRole('tab', { name: 'Details' }));
    const report = document.querySelector('.report') as HTMLElement;
    expect([...report.querySelectorAll('h3')].map((head) => head.textContent)).toEqual(['What will play', 'The music', 'What else was tried', 'Quality checks']);
    const text = report.textContent ?? '';
    const order = ['What will play', 'Blend', 'You chose', 'The music', 'Leaves Song 1 at 1:00', 'What else was tried', 'No safe vocal runway', 'Quality checks', 'The beats line up'];
    const places = order.map((words) => text.indexOf(words));
    expect(places.every((place) => place >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });
});
