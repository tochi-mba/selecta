import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { status } from '../test/backend';
import { Preparing, READY_NEEDED } from './Setup';

describe('partial library readiness', () => {
  it('offers the first mix as soon as enough songs are ready while analysis continues', () => {
    render(
      <Preparing
        status={status({
          analysis_running: true,
          counts: { total: 30, music: 24, set_aside: 6, analysed: 10, ready: READY_NEEDED, lyrics: 8 },
          scan: { status: 'done', folder: 'C:\\Music', music: 24, set_aside: 6 },
        })}
        onAnalyse={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Make my first mix' })).toHaveAttribute('href', '/mixes');
    expect(screen.getByText(/14 still to analyse/)).toBeInTheDocument();
  });

  it('does not promise a playable mix before the real readiness threshold', () => {
    render(
      <Preparing
        status={status({ counts: { total: 20, music: 20, set_aside: 0, analysed: 20, ready: READY_NEEDED - 1, lyrics: 5 } })}
        onAnalyse={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Make my first mix' })).toBeNull();
    expect(screen.getByText(/More songs need timed lyrics or instrumental cues/)).toBeInTheDocument();
  });
});
