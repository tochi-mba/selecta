import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SpeakerPicker } from './SpeakerPicker';
import { pickerOrder, type Candidate } from './whereToPlay';

// ADR-0475 rule 4: "Where should the music play?"

const device = (device_id: string, over: Partial<Candidate> = {}): Candidate => ({ device_id, name: device_id, online: true, songs: 10, last_seen_at: 100, reported_at: 50, ...over });
const ids = new Map<string, ReadonlySet<number>>([['Laptop', new Set([1, 2, 3])], ['Phone', new Set([1])]]);
const options = pickerOrder({ devices: [device('Phone'), device('Laptop'), device('Tablet', { needsFolder: true })], speaker: null, defaultId: null, thisDeviceId: 'Phone', mixIds: [1, 2, 3], ids });

function open(over: Partial<Parameters<typeof SpeakerPicker>[0]> = {}) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  render(<SpeakerPicker options={options} suggested="Laptop" defaultAway={null} total={3} thisDeviceId="Phone" now={100} onChoose={onChoose} onCancel={onCancel} {...over} />);
  return { onChoose, onCancel };
}

describe('the speaker picker', () => {
  it('lists each device with what it holds, the suggested one first and marked once, unusable ones disabled with why', () => {
    open();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toBeChecked();
    expect(radios[0]).toHaveAccessibleName('Laptop: All 3 songs');
    expect(radios[1]).toHaveAccessibleName('Phone: This device · 1 of 3 songs');
    expect(radios[2]).toBeDisabled();
    expect(radios[2]).toHaveAccessibleName('Tablet: Needs its music folder allowed again.');
    expect(screen.getAllByText('Suggested')).toHaveLength(1);
  });

  it('Confirm plays on the chosen device and passes the default tick', async () => {
    const { onChoose } = open();
    await userEvent.click(screen.getAllByRole('radio')[1]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Make this my default' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ device_id: 'Phone' }), true);
  });

  it('Cancel and Escape choose nothing', async () => {
    const { onChoose, onCancel } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('says when the default is not open', () => {
    open({ defaultAway: device('Kitchen', { online: false }) });
    expect(screen.getByText('Your default speaker, Kitchen, isn’t open. Choose another for now.')).toBeInTheDocument();
  });
});
