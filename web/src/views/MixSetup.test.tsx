import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeBackend, status } from '../test/backend';
import { MixSetup } from './MixSetup';

describe('five-stop energy arc input parity', () => {
  it('keeps numeric input, slider and drawn stops on the same exact preference values', () => {
    fakeBackend({ 'POST /steer': {} });
    render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
    const numeric = screen.getByRole('spinbutton', { name: 'Energy arc start numeric value' });
    const range = screen.getByRole('slider', { name: 'Energy arc start' });
    fireEvent.change(numeric, { target: { value: '88' } });
    expect(range).toHaveValue('88');
    fireEvent.change(range, { target: { value: '42' } });
    expect(numeric).toHaveValue(42);
  });
  it('cancels an interrupted pointer stroke without leaving a half-drawn energy choice', () => {
    fakeBackend({ 'POST /steer': {} });
    render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
    const graphic = screen.getByRole('img', { name: /Draw energy arc/ });
    const numeric = screen.getByRole('spinbutton', { name: 'Energy arc start numeric value' });
    vi.spyOn(graphic, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 40 } as DOMRect);
    Object.defineProperty(graphic, 'setPointerCapture', { configurable: true, value: vi.fn() });
    expect(numeric).toHaveValue(62);
    fireEvent.pointerDown(graphic, { pointerId: 11, isPrimary: true, button: 0, clientX: 0, clientY: 0 });
    expect(numeric).toHaveValue(100);
    fireEvent.pointerCancel(graphic, { pointerId: 11 });
    expect(numeric).toHaveValue(62);
  });

  it('SF-0222-04 shows a preset as its exact five stops, and it can be put back to each mix’s arc', () => {
    fakeBackend({ 'POST /steer': {} });
    render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
    const stops = ['start', 'early', 'middle', 'late', 'finish'].map((stop) => screen.getByRole('spinbutton', { name: `Energy arc ${stop} numeric value` }));
    const preset = screen.getByRole('button', { name: 'Build to a peak' });
    expect(preset).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(preset);
    expect(preset).toHaveAttribute('aria-pressed', 'true');
    expect(stops.map((input) => (input as HTMLInputElement).valueAsNumber)).toEqual([35, 50, 65, 85, 100]);
    // an exact edit after a preset is the listener's own shape, no longer the preset
    fireEvent.change(stops[0], { target: { value: '36' } });
    expect(preset).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Use each mix’s arc' }));
    expect(screen.getByRole('button', { name: 'Use each mix’s arc' })).toBeDisabled();
    expect(stops.map((input) => (input as HTMLInputElement).valueAsNumber)).toEqual([62, 72, 100, 85, 68]);
  });
});
