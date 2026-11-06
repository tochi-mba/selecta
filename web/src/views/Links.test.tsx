import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeBackend } from '../test/backend';
import { HarmonicDiscoveries } from './Links';

describe('harmonic discovery auditions', () => {
  it('cues original audio and persists connection feedback without adding songs', async () => {
    const calls = fakeBackend({
      'GET /discoveries': [{ id: 7, song_a: 1, song_b: 2, title_a: 'First', title_b: 'Second', artist_a: 'A', artist_b: 'B', status: 'new', payload: { a_at: 12, b_at: 30, bars: 8, transpose: 10 } }],
      'POST /discoveries/7/review': { id: 7, status: 'approved' },
    });
    render(<HarmonicDiscoveries />);
    const audio = await screen.findByLabelText('Audition Second') as HTMLAudioElement;
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(30);
    expect(audio).toHaveAttribute('src', '/api/songs/2/audio');
    expect(screen.getByText(/comparison transposes B by -2/)).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Interesting connection' });
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toHaveAttribute('aria-pressed', 'true'));
    expect(calls.some((call) => call.path === '/discoveries/7/review' && (call.body as { verdict: string }).verdict === 'approved')).toBe(true);
    expect(calls.some((call) => call.path.startsWith('/mix'))).toBe(false);
  });

  it('reports loading failure instead of pretending the collection is empty', async () => {
    fakeBackend({});
    render(<HarmonicDiscoveries />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load harmonic discoveries');
  });
});
