import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Folders, Jobs } from '../api';
import { setFlags } from '../flags';
import { NeedsYou } from './WorkshopPanels';

/** CI-0180-01: Overview says whether the library can be mixed, and which one thing to do first. */
const jobs = (more: Partial<Jobs> = {}): Jobs => ({
  worker: { running: true, rendering_the_mix: false }, mix: { queued: 0, rendering: 0, failed: 0, none: 0, ready: 3 }, drafts_in_line: 0,
  storage_full: false, analysis: { running: false, paused: false, asked_for: 0, left: 0 }, failed_seams: [], failed_songs: [], estimates: '',
  ...more,
} as Jobs);
const goneFolder = { folders: [{ path: 'D:\\Music', available: false }] } as unknown as Folders;

afterEach(() => setFlags(null));

describe('CI-0180-01 library health and one next action', () => {
  it('says the library can be mixed, with the real ready count, when nothing blocks it', () => {
    render(<NeedsYou jobs={jobs()} readySongs={40} folders={null} />);
    expect(screen.getByText('Your library can be mixed: 40 songs ready').closest('.status')).toHaveClass('status-ready');
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument();
    expect(screen.queryByText(/Do this first/)).toBeNull();
  });

  it('says mixing is blocked by too few ready songs, and puts that fix first above the rest', () => {
    render(<NeedsYou jobs={jobs({ failed_songs: [{ id: 3, title: 'Synthetic', artist: null }] as Jobs['failed_songs'] })} readySongs={4} folders={goneFolder} />);
    expect(screen.getByText('Mixing is blocked: 4 of the 6 mix-ready songs a mix needs').closest('.status')).toHaveClass('status-blocked');
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveClass('needs-you-first');
    expect(rows[0]).toHaveTextContent('Do this first. SelectaDJ needs 6 mix-ready songs to build a mix, and has 4.');
    expect(within(rows[0]).getByRole('link', { name: 'See what’s holding them back' })).toBeInTheDocument();
    // one first action only; the others stay reachable, unmarked
    expect(screen.getAllByText(/Do this first/)).toHaveLength(1);
    expect(within(rows[1]).getByRole('link', { name: 'Look at those songs' })).toBeInTheDocument();
    expect(within(rows[2]).getByRole('link', { name: 'See your folders' })).toBeInTheDocument();
  });

  it('tells a full cache apart from an unmixable library', () => {
    render(<NeedsYou jobs={jobs({ storage_full: true })} readySongs={12} folders={goneFolder} />);
    expect(screen.getByText('Your library can be mixed, with 12 songs ready, but rendering is blocked').closest('.status')).toHaveClass('status-blocked');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Do this first. Rendering is waiting until there’s more room for it.');
  });

  it('with the flag off the list is exactly as before and nothing is marked first', () => {
    setFlags({ 'workspace.library_health': false });
    render(<NeedsYou jobs={jobs()} readySongs={4} folders={goneFolder} />);
    expect(screen.queryByText(/Mixing is blocked/)).toBeNull();
    expect(screen.queryByText(/Do this first/)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
