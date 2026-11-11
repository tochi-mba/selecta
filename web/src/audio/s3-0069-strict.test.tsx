import { render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { clearToasts } from '../ui/toasts';

/**
 * ADR-0069 (S3-0069-06): React StrictMode mounts, unmounts and mounts again in development. That must
 * not leave a second sound source behind: nothing makes an AudioContext or an audio element until the
 * listener presses Play, and swapping between the phone and desk layouts adds none either.
 */

let contexts = 0;
beforeEach(() => {
  clearToasts();
  contexts = 0;
  window.history.pushState({}, '', '/listen');
  vi.stubGlobal('AudioContext', class {
    constructor() { contexts += 1; }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('S3-0069-06 StrictMode and layout swaps', () => {
  it('a StrictMode mount and a layout swap make no AudioContext and no audio element before Play', async () => {
    fakeBackend({
      'GET /status': status(),
      'GET /mix': { mix: songs(seam('ready', 'a'), seam('ready', 'b')), name: 'Test mix', can_undo: false },
      'GET /vibes': [],
    });
    render(<StrictMode><App /></StrictMode>);
    within(await screen.findByRole('navigation', { name: 'Main' }));
    expect(contexts).toBe(0);
    expect(document.querySelectorAll('audio')).toHaveLength(0);

    for (const width of [375, 1440, 375]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      window.dispatchEvent(new Event('resize'));
    }
    expect(contexts).toBe(0);
    expect(document.querySelectorAll('audio')).toHaveLength(0);
  });
});
