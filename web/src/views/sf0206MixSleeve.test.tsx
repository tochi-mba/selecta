import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import { DraftInfo, DraftList } from '../api';
import { fakeBackend } from '../test/backend';
import { MixSignature } from '../ui/MusicObjects';
import { CurrentMix } from './CurrentMix';
import { Drafts } from './Drafts';

/** SF-0206-04: one Mix Sleeve, drawn from the returned song order, looks the same wherever a mix
 * appears: the current mix on Make a Mix and each draft in My Mixes. */

const ORDER = [7, 3, 12, 5];

const draft = (id: number, songIds: number[] | undefined): DraftInfo => ({
  id, name: `Draft ${id}`, songs: songIds?.length ?? 0, seconds: 600, seams: 0, ready: 0, failed: 0, waiting: 0,
  rendering: false, place: null, eta: null, to_render: 0, missing: 0, song_ids: songIds,
});
const list = (drafts: DraftInfo[]): DraftList => ({
  drafts, current: { name: 'Current', songs: 4, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false,
});

const strokes = (svg: Element | null) => [...(svg?.querySelectorAll('path') ?? [])].map((path) => path.getAttribute('d'));

describe('the Mix Sleeve across surfaces (SF-0206-04)', () => {
  it('the compact sleeve draws the same strokes as the full one', () => {
    const full = render(<MixSignature items={ORDER.map((song_id) => ({ song_id }))} />);
    const compact = render(<MixSignature items={ORDER.map((song_id) => ({ song_id }))} compact />);
    expect(strokes(compact.container.querySelector('svg'))).toEqual(strokes(full.container.querySelector('svg')));
    expect(compact.container.querySelector('svg')).toHaveClass('mix-signature', 'compact');
    expect(compact.container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('a draft in My Mixes wears the sleeve the current mix would wear for the same song order', async () => {
    const current = render(
      <CurrentMix mix={ORDER.map((song_id) => ({ song_id })) as never} mixName="Current" now={{ phase: 'idle' } as never}
        player={{ togglePause: vi.fn() } as never} setView={vi.fn()} />,
    );
    const expected = strokes(current.container.querySelector('svg.mix-signature'));
    expect(expected).toHaveLength(3);
    current.unmount();

    fakeBackend({ 'GET /drafts': list([draft(1, ORDER), draft(2, [...ORDER].reverse()), draft(3, undefined)]) });
    render(<Drafts notify={vi.fn()} openDraft={vi.fn()} playDraft={vi.fn(async () => {})} setView={vi.fn()} />);
    const first = (await screen.findByText('Draft 1')).closest('li')!;
    expect(strokes(first.querySelector('svg.mix-signature'))).toEqual(expected);
    const reordered = screen.getByText('Draft 2').closest('li')!;
    expect(strokes(reordered.querySelector('svg.mix-signature'))).not.toEqual(expected);
    // an older server that sends no order gets no sleeve rather than a made-up one
    expect(screen.getByText('Draft 3').closest('li')!.querySelector('svg.mix-signature')).toBeNull();
  });
});
