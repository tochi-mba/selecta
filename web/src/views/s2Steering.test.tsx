import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend, status } from '../test/backend';
import { MixSetup } from './MixSetup';

// T0151: extreme curves, rapid input and invalid values on the five-stop energy arc.
function show() {
  render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
  return ['start', 'early', 'middle', 'late', 'finish'].map((stop) => screen.getByRole('spinbutton', { name: `Energy arc ${stop} numeric value` }) as HTMLInputElement);
}

const arcPosts = (calls: { method: string; path: string; body?: unknown }[]) =>
  calls.filter((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { action?: string }).action === 'energy_arc').map((call) => (call.body as { value: number[] | null }).value);

afterEach(() => vi.useRealTimers());

describe('T0151 energy arc edges', () => {
  it('clamps extreme and invalid stop values to whole numbers from 0 to 100', () => {
    fakeBackend({ 'POST /steer': {} });
    const stops = show();
    fireEvent.change(stops[0], { target: { value: '150' } });
    fireEvent.change(stops[1], { target: { value: '-40' } });
    fireEvent.change(stops[2], { target: { value: '33.7' } });
    fireEvent.change(stops[3], { target: { value: '' } });
    expect(stops.slice(0, 4).map((input) => input.valueAsNumber)).toEqual([100, 0, 34, 0]);
  });

  it('accepts the flattest and steepest curves exactly', async () => {
    vi.useFakeTimers();
    const calls = fakeBackend({ 'POST /steer': {} });
    const stops = show();
    stops.forEach((input) => fireEvent.change(input, { target: { value: '0' } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(arcPosts(calls).at(-1)).toEqual([0, 0, 0, 0, 0]);
    stops.forEach((input) => fireEvent.change(input, { target: { value: '100' } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(arcPosts(calls).at(-1)).toEqual([100, 100, 100, 100, 100]);
  });

  it('rapid slider input sends one save, carrying only the last shape', async () => {
    vi.useFakeTimers();
    const calls = fakeBackend({ 'POST /steer': {} });
    show();
    const middle = screen.getByRole('slider', { name: 'Energy arc middle' });
    for (const value of ['10', '90', '20', '80', '55']) {
      fireEvent.change(middle, { target: { value } });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    }
    expect(arcPosts(calls)).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(arcPosts(calls)).toEqual([[62, 72, 55, 85, 68]]);
    expect(middle).toHaveValue('55');
  });
});
