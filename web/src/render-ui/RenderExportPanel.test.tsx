import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RenderExportPanel } from './RenderExportPanel';

describe('portable export UI', () => {
  it('offers phones the same render control without an installed engine', () => {
    render(<RenderExportPanel filename="mix.wav" request={{
      recipe: { recipeId: 'a', revisionId: 'v', schemaVersion: 1,
        sampleRate: 44100, channels: 1, totalFrames: 1024, clips: [] },
      sources: new Map(),
      livePlaybackActive: () => false,
    }} />);
    expect(screen.getByRole('button', { name: 'Render locally' })).toBeEnabled();
    expect(screen.getByText(/Browser storage available:/)).toBeInTheDocument();
    expect(screen.getByText(/FLAC/)).toBeInTheDocument();
  });
  it('protects live audio by disabling exports during playback', () => {
    render(<RenderExportPanel filename="mix.wav" request={{
      recipe: { recipeId: 'b', revisionId: 'v', schemaVersion: 1,
        sampleRate: 44100, channels: 1, totalFrames: 1024, clips: [] },
      sources: new Map(),
      livePlaybackActive: () => true,
    }} />);
    expect(screen.getByRole('button', { name: 'Render locally' })).toBeDisabled();
  });
});
