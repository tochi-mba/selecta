import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MixItem } from '../api';
import { EnergyHorizon, EnergyOverview, RouteDiagram, SeamDiagram, seamFamily, SongMotif } from './MusicObjects';

describe('honest shared musical objects', () => {
  it('gives one library ID the same decorative motif without depending on titles or artwork', () => {
    const { container, rerender } = render(<SongMotif songId={33} />);
    const original = container.querySelector('svg')?.innerHTML;
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<SongMotif songId={33} large />);
    expect(container.querySelector('svg')?.innerHTML).toBe(original);
    rerender(<SongMotif songId={34} />);
    expect(container.querySelector('svg')?.innerHTML).not.toBe(original);
  });

  it('uses the rendered move rather than disguising a fallback as the selected technique', () => {
    const seam: NonNullable<MixItem['seam']> = {
      settings: { move: 'filter_sweep', bars: 8 },
      state: { status: 'ready', key: 'made-1', style: 'echo_out', label: 'Echo out', fell_back: true },
    };
    render(<SeamDiagram seam={seam} from="Before" into="After" names={{ filter_sweep: 'Filter sweep', echo_out: 'Echo out' }} />);
    const graphic = screen.getByRole('img', { name: /Rendered transition.*Echo out.*Before into After.*Different from the requested move/ });
    expect(graphic).toHaveAttribute('data-family', 'effect');
    expect(graphic).toHaveTextContent('different move');
  });

  it('never calls an automatic unrendered transition a confirmed technique', () => {
    const seam: NonNullable<MixItem['seam']> = {
      settings: { move: 'auto' },
      state: { status: 'queued', key: 'queued-1' },
    };
    render(<SeamDiagram seam={seam} from="Before" into="After" />);
    expect(screen.getByRole('img', { name: /Queued to render.*Selecta’s choice/ })).toHaveAttribute('data-family', 'unknown');
    expect(seamFamily('word_cut')).toBe('words');
    expect(seamFamily('stem_intertwine')).toBe('stems');
    expect(seamFamily('cut_on_one')).toBe('cut');
    expect(seamFamily('nonsense')).toBe('unknown');
  });

  it('shows only returned ordered route songs, and never implies a proposed path has joined', () => {
    render(<RouteDiagram
      songs={[{ id: 8, title: 'Bridge' }, { id: 9, title: 'Requested' }]}
      requestedId={9}
      state="proposed"
    />);
    const route = screen.getByRole('list', { name: /Proposed route — nothing added/ });
    expect(route).toHaveTextContent('Bridge');
    expect(route).toHaveTextContent('Requested');
    expect(route).toHaveTextContent('Extra bridge song');
    expect(route).toHaveTextContent('Requested song');
    expect(route.children).toHaveLength(2);
    expect(screen.queryByText('Already playing')).toBeNull();
  });

  it('keeps requested and measured energy explicitly separate, with no invented measurement', () => {
    const { container } = render(<EnergyHorizon values={[20, 40, 60, 80, 100]} source="intention" />);
    expect(screen.getByRole('img', { name: /Draw energy arc/ })).toBeInTheDocument();
    expect(container.querySelector('polyline.achieved')).toBeNull();
    const { container: measured } = render(<EnergyHorizon values={[0, 25, 50, 75, 100]} source="measured" />);
    expect(measured.querySelector('polyline.achieved')).toBeInTheDocument();
    render(<EnergyHorizon values={[10, 20]} source="measured" />);
    expect(screen.getByText(/No complete measured energy available/)).toBeInTheDocument();
  });

  it('keeps unknown song energy as an unknown gap and selects only the actual row', () => {
    const onSelect = vi.fn();
    const make = (song_id: number, energy?: number): MixItem => ({
      position: song_id - 1, song_id, title: 'Song ' + song_id, artist: 'Artist',
      bpm: 120, key: '8A', duration: 100, locked: false, seam: null, energy,
    });
    render(<EnergyOverview items={[make(1, 0.2), make(2), make(3, 0.8)]} selectedIndex={-1} onSelect={onSelect} />);
    const unknown = screen.getByRole('button', { name: /Select Song 2, song 2, energy not measured/ });
    expect(unknown).toHaveTextContent('?');
    fireEvent.click(unknown);
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(screen.getByText(/not your requested shape or a quality score/)).toBeInTheDocument();
  });
});
