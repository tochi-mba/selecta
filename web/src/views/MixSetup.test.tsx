import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
