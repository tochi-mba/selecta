import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceWorkRows, deviceWorkLines, type DeviceWork } from './DeviceActivity';
import { setTonalActivity, setTonalLeft } from './tonalActivity';

// T-20261126-36c7: the browser shell's Activity drawer says what this device is doing, from each
// module's own state, in plain words.

const IDLE: DeviceWork = { measuring: 'idle', left: 0, timing: false, upload: { saving: false, saved: 0 }, studio: null, model: null };
const titles: Record<number, string> = { 1: 'Alpha', 2: 'Bravo' };
const titleOf = (id: number) => titles[id] ?? null;

afterEach(() => {
  setTonalActivity('idle');
  setTonalLeft(0, false);
});

describe('what this device is doing, in words', () => {
  it('says nothing while nothing is happening', () => {
    expect(deviceWorkLines(IDLE, titleOf)).toEqual([]);
  });

  it('counts the songs left to measure, and says when the beat finder is being timed', () => {
    expect(deviceWorkLines({ ...IDLE, measuring: 'measuring', left: 12, timing: true }, titleOf)).toEqual([
      'Measuring songs on this device: 12 songs to go.',
      'Timing the beat finder on this device with the song being measured.',
    ]);
    expect(deviceWorkLines({ ...IDLE, measuring: 'waiting_music', left: 1 }, titleOf)).toEqual(['Measuring songs carries on when the music stops: 1 song to go.']);
  });

  it('says measurements are being saved to the account, and how many were', () => {
    expect(deviceWorkLines({ ...IDLE, upload: { saving: true, saved: 3 } }, titleOf)).toEqual(['Saving song measurements to your account.']);
    expect(deviceWorkLines({ ...IDLE, upload: { saving: false, saved: 3 } }, titleOf)).toEqual(['Saved measurements of 3 songs to your account on this visit.']);
  });

  it('names the transition being prepared, and how many more wait', () => {
    expect(deviceWorkLines({ ...IDLE, studio: { making: { a: 1, b: 2, forRequest: false }, waiting: 2, made: 1 } }, titleOf)).toEqual([
      'Preparing the transition from Alpha into Bravo.',
      '2 more transitions to prepare.',
    ]);
    expect(deviceWorkLines({ ...IDLE, studio: { making: { a: 1, b: 9, forRequest: true }, waiting: 0, made: 0 } }, titleOf)).toEqual(['Preparing a transition for a request.']);
    expect(deviceWorkLines({ ...IDLE, studio: { making: null, waiting: 0, made: 4 } }, titleOf)).toEqual(['4 transitions prepared on this device on this visit.']);
  });

  it('shows the beat finder download as a share', () => {
    expect(deviceWorkLines({ ...IDLE, model: { received: 25, total: 100 } }, titleOf)).toEqual(['Downloading the beat finder to this device: 25%.']);
  });

  it('never uses the words members are not shown', () => {
    const all = [
      ...deviceWorkLines({ measuring: 'measuring', left: 2, timing: true, upload: { saving: true, saved: 1 }, studio: { making: { a: 1, b: 2, forRequest: true }, waiting: 1, made: 1 }, model: { received: 1, total: 2 } }, titleOf),
      ...deviceWorkLines({ ...IDLE, upload: { saving: false, saved: 1 }, studio: { making: null, waiting: 0, made: 1 } }, titleOf),
    ].join(' ');
    expect(all).not.toMatch(/facts|planner|render|audit|candidate|implementation|flag|worker|not yet|soon/i);
  });
});

describe('the rows in the drawer', () => {
  it('follow the measuring as it moves, without asking anything', () => {
    render(<DeviceWorkRows workspaceId="ws-1" titleOf={titleOf} />);
    expect(screen.queryByRole('region', { name: 'On this device' })).toBeNull();
    act(() => {
      setTonalActivity('measuring');
      setTonalLeft(5, false);
    });
    expect(screen.getByText('Measuring songs on this device: 5 songs to go.')).toBeTruthy();
    act(() => setTonalLeft(4, false));
    expect(screen.getByText('Measuring songs on this device: 4 songs to go.')).toBeTruthy();
  });
});
