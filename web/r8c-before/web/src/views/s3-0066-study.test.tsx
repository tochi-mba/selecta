import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioOwner } from '../audio/focus';
import { fakeBackend, Reply } from '../test/backend';
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

describe('S3-0066 setup and the one-trial layout', () => {
  it('each setup field is labelled and required, Open waits for all three, and a bad code or an empty study says so (S3-0066-01)', async () => {
    fakeBackend({ 'GET /listening': (_body: unknown, url: string) => (url.includes('empty') ? [] : new Reply(404, { detail: 'Not Found' })) });
    render(<Listening />);
    const open = screen.getByRole('button', { name: 'Open study' });
    for (const name of ['Study code', 'Listener nickname', 'Listening setup']) {
      expect(screen.getByLabelText(name)).toBeRequired();
    }
    expect(screen.getByText('The code you were given for this study.')).toBeInTheDocument();
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'ear' } });
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: '   ' } });
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
    expect(open).toBeEnabled();
    fireEvent.click(open);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this listening study. Check the study code and try again.');
    fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'empty' } });
    fireEvent.click(open);
    expect(await screen.findByText('No trials are registered for this study code.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('one comparison at a time, with A and B built the same way and the same labels on every trial (S3-0066-02)', async () => {
    fakeBackend({ 'GET /listening': [{ id: 't1' }, { id: 't2' }], 'POST /listening/t1/response': {} });
    const { container } = render(<Listening />);
    await open();
    const shape = () => [...container.querySelectorAll('.study-version')].map((version) => ({
      heading: version.querySelector('h3')?.textContent,
      audio: version.querySelectorAll('audio[controls]').length,
      grades: version.querySelectorAll('input[type="radio"]').length,
      issues: version.querySelectorAll('input[type="checkbox"]').length,
    }));
    expect(container.querySelectorAll('.study-trial')).toHaveLength(1);
    expect(screen.getByText('Comparison 1 of 2')).toBeInTheDocument();
    const first = shape();
    expect(first.map((version) => version.heading)).toEqual(['Version A', 'Version B']);
    expect(first[0]).toEqual({ ...first[1], heading: 'Version A' });
    expect(first[0].audio).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cannot judge' }));
    expect(await screen.findByText('Comparison 2 of 2')).toBeInTheDocument();
    expect(container.querySelectorAll('.study-trial')).toHaveLength(1);
    expect(shape()).toEqual(first);
  });
});

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
