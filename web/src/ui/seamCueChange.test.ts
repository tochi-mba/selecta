import { describe, expect, it } from 'vitest';
import type { MixItem } from '../api';
import { seamFacts } from './seam';

// T0252: the page side of a cue moved while the old render finishes. The server keeps the new
// choice (settings) apart from what has really been made (state); these are the words it shows.

const seam = (state: Record<string, unknown>, settings: Record<string, unknown> = { move: 'echo_out', exit_bar: 1 }) =>
  ({ settings, state: { key: 'new', ...state } }) as unknown as MixItem['seam'];

describe('a cue moved while the previous render finishes', () => {
  it('the new choice is never shown as ready while only the old render is', () => {
    expect(seamFacts(seam({ status: 'none' })).kind).toBe('planned');
    expect(seamFacts(seam({ status: 'queued' })).kind).toBe('queued');
    expect(seamFacts(seam({ status: 'rendering' })).kind).toBe('working');
  });

  it('once rendered with a different move, says what will play and what was asked', () => {
    const facts = seamFacts(seam({ status: 'ready', passed: true, style: 'bass_swap_blend', label: 'Blend' }), { echo_out: 'Echo out' });
    expect(facts.kind).toBe('warning');
    expect(facts.words).toBe('Blend will play, because Echo out wouldn’t work here');
    expect(facts.asked).toBe('Echo out');
  });

  it('once rendered as asked, says ready with no difference', () => {
    const facts = seamFacts(seam({ status: 'ready', passed: true, style: 'echo_out', label: 'Echo out' }), { echo_out: 'Echo out' });
    expect(facts).toEqual({ kind: 'ready', words: 'Echo out, ready', asked: 'Echo out' });
  });
});
