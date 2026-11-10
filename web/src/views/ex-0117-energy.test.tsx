import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { status } from '../test/backend';
import { MixSetup } from './MixSetup';

// EX-0117-03: the five energy stops on screen are exactly what the server is asked to
// keep, and a slow older save can never leave the server, or the screen, on an older shape.

afterEach(() => vi.unstubAllGlobals());

describe('EX-0117-03 energy stops under rapid change', () => {
  it('sends saves in order so the last shape wins, and a slow first answer does not move the stops back', async () => {
    const sent: number[][] = [];
    let finishFirst: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; value?: number[] };
      if (body.action === 'energy_arc' && body.value) {
        sent.push(body.value);
        if (sent.length === 1) await new Promise<void>((done) => { finishFirst = done; });
        return new Response(JSON.stringify({ energy_arc: body.value }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
    const middle = screen.getByRole('spinbutton', { name: 'Energy arc middle numeric value' });
    const stops = ['start', 'early', 'middle', 'late', 'finish'].map((stop) => screen.getByRole('spinbutton', { name: `Energy arc ${stop} numeric value` }) as HTMLInputElement);
    const before = stops.map((input) => input.valueAsNumber);

    fireEvent.change(middle, { target: { value: '40' } });
    await waitFor(() => expect(sent).toHaveLength(1));
    fireEvent.change(middle, { target: { value: '55' } });
    // the second save waits behind the first rather than racing it
    await new Promise((done) => setTimeout(done, 500));
    expect(sent).toHaveLength(1);
    finishFirst();
    await waitFor(() => expect(sent).toHaveLength(2));

    const expected = [...before];
    expected[2] = 55;
    expect(sent[1]).toEqual(expected);
    expect(stops.map((input) => input.valueAsNumber)).toEqual(expected);
  });

  it('every stop is a native number field, so it is editable from the keyboard alone', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    render(<MixSetup status={status()} mix={[]} refreshStatus={() => {}} notify={() => {}} onClose={() => {}} />);
    for (const stop of ['start', 'early', 'middle', 'late', 'finish']) {
      const field = screen.getByRole('spinbutton', { name: `Energy arc ${stop} numeric value` }) as HTMLInputElement;
      expect(field.type).toBe('number');
      expect(field).toBeEnabled();
      expect(field.tabIndex).toBe(0);
    }
  });
});
