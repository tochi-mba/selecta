import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioOwner } from '../audio/focus';
import { fakeBackend } from '../test/backend';
import { Listening } from './Listening';

/**
 * ADR-0066 (S3-0066-04/07): the A and B clips share the one audio owner, assistive technology is
 * told which version is playing, and nothing on the trial names a method, renderer or condition.
 */

const open = async () => {
  fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'flow' } });
  fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'ear' } });
  fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
  await screen.findByText(/Comparison \d+ of/);
};

let paused: string[] = [];
beforeEach(() => {
  sessionStorage.clear();
  paused = [];
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    paused.push(this.getAttribute('aria-label') ?? '');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('S3-0066 one owner and an announced clip', () => {
  it('says which version is playing, and starting B stops A through the one audio owner (S3-0066-04)', async () => {
    fakeBackend({ 'GET /listening': [{ id: 't1' }] });
    render(<Listening />);
    await open();
    const now = screen.getByText('Nothing is playing');
    expect(now).toHaveAttribute('role', 'status');

    fireEvent.play(screen.getByLabelText('Version A'));
    expect(now).toHaveTextContent('Now playing: Version A');
    expect(audioOwner()?.id).toBe('listening-t1-a');

    fireEvent.play(screen.getByLabelText('Version B'));
    expect(paused).toContain('Version A');
    expect(audioOwner()?.id).toBe('listening-t1-b');
    expect(now).toHaveTextContent('Now playing: Version B');

    fireEvent.pause(screen.getByLabelText('Version B'));
    expect(now).toHaveTextContent('Nothing is playing');
    expect(audioOwner()).toBeNull();
  });

  it('nothing on the trial, its labels or its clip addresses names a method or condition (S3-0066-07)', async () => {
    fakeBackend({ 'GET /listening': [{ id: 't1' }] });
    const { container } = render(<Listening />);
    await open();
    const labels = [...container.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label')).join(' ');
    const sources = [...container.querySelectorAll('audio')].map((node) => node.getAttribute('src')).join(' ');
    const shown = `${container.textContent} ${labels} ${sources}`.toLowerCase();
    for (const leak of ['baseline', 'candidate', 'renderer', 'method', 'condition', 'control', 'treatment', 'v1', 'v2']) {
      expect(shown).not.toContain(leak);
    }
    expect(sources).toBe('/api/listening/t1/a/audio /api/listening/t1/b/audio');
  });
});
