import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeBackend, Reply, status } from '../test/backend';
import { MixSetup } from './MixSetup';

const row = (id: number, title: string, more: Record<string, unknown> = {}) => ({
  id, artist: 'Example Artist', title, genre: 'pop', duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false, ...more,
});

const open = (more: Parameters<typeof status>[0] = {}) =>
  render(<MixSetup status={status(more)} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);

// SF-0217-05: the Compass never promises a destination it can't reach, or a match it doesn't have.
describe('SF-0217-05 feasibility limits are honest', () => {
  it('says plainly when no ready song matches, rather than offering songs that can’t be mixed', async () => {
    fakeBackend({
      'GET /songs': [row(3, 'Set Aside', { never: true }), row(4, 'No Lyrics', { lyric_status: null })],
    });
    open();
    fireEvent.change(screen.getByLabelText('Take me to'), { target: { value: 'zz' } });
    const list = await screen.findByRole('listbox', { name: 'Destination songs' });
    expect(await within(list).findByText('No ready songs match yet.')).toBeInTheDocument();
    expect(within(list).queryAllByRole('option')).toHaveLength(0);
  });

  it('says a destination is something mixes try for, and that they finish as near as they can', async () => {
    fakeBackend({ 'GET /songs': [] });
    open({ steering: { mix_language: 'balanced', stems: 'sometimes', energy_arc: null, target: '7', target_label: 'Midnight - Example Artist' } });
    expect(screen.getByText(/Mixes will try to finish on/)).toHaveTextContent('Mixes will try to finish on Midnight - Example Artist');
    expect(screen.getByText(/finishes as near as it can/)).toBeInTheDocument();
    expect(screen.queryByText(/will finish on|guaranteed/i)).toBeNull();
  });

  it('a failed search is a failure with a retry, never an empty “no match”', async () => {
    fakeBackend({ 'GET /songs': new Reply(500, { detail: 'broken' }) });
    open();
    fireEvent.change(screen.getByLabelText('Take me to'), { target: { value: 'midnight' } });
    expect(await screen.findByText('Couldn’t search ready songs.')).toBeInTheDocument();
    expect(screen.queryByText('No ready songs match yet.')).toBeNull();
  });
});
