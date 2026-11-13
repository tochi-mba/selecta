import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import cloud from '../../../src/selecta/flags/cloud.json' with { type: 'json' };
import { DEVICE_CHECK_FLAG, DEVICE_CHECK_STEPS, DeviceCheck, deviceRecord, showsDeviceCheck } from './DeviceCheck';
import { IOS_WARNING } from './deviceInfo';

// SC-0415-03/04/05 and SC-0399-02: the real-device checks stay with a person. This page only reads
// what the browser supports, lists the checks and writes the record; nothing is marked as passed
// until the person marks it.

afterEach(cleanup);

const iphone = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  maxTouchPoints: 5, wakeLock: true, audio: true, sampleRate: 48_000, cacheStorage: true,
};
const when = new Date('2026-11-12T10:00:00Z');

describe('the device check', () => {
  it('is off by default and needs an explicit true to show', () => {
    expect((cloud.flags as Record<string, { default?: boolean }>)[DEVICE_CHECK_FLAG].default).toBe(false);
    expect(showsDeviceCheck({})).toBe(false);
    expect(showsDeviceCheck({ [DEVICE_CHECK_FLAG]: true })).toBe(true);
  });

  it('names the task each check is for', () => {
    expect(DEVICE_CHECK_STEPS.map((step) => step.task)).toEqual(['SC-0415-03', 'SC-0415-04', 'SC-0415-04', 'SC-0415-05', 'SC-0399-02']);
  });

  it('records what the browser supports and leaves every check unmarked', () => {
    const record = deviceRecord(iphone, {}, '', when);
    expect(record).toContain('Device check, 2026-11-12: Safari on iPhone (phone)');
    expect(record).toContain('screen wake lock: yes; iOS: yes; home-screen app: no');
    expect(record).toContain('Audio sample rate: 48000; offline copies (Cache Storage): yes');
    expect(record).toContain(`Speaker note shown here: ${IOS_WARNING}`);
    for (const step of DEVICE_CHECK_STEPS) expect(record).toContain(`${step.task} ${step.id}: not checked`);
  });

  it('writes what the person marks, and a second press clears it', async () => {
    render(<DeviceCheck facts={iphone} now={() => when} />);
    const user = userEvent.setup();
    const transfer = screen.getByRole('group', { name: 'Result for SC-0415-03 transfer' });
    await user.click(transfer.querySelector('button')!);
    const seams = screen.getByRole('group', { name: 'Result for SC-0399-02 seams' });
    await user.click(seams.querySelectorAll('button')[1]);
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Wi-Fi dropped twice');
    const record = () => (screen.getByRole('textbox', { name: 'Record' }) as HTMLTextAreaElement).value;
    expect(record()).toContain('SC-0415-03 transfer: pass');
    expect(record()).toContain('SC-0399-02 seams: fail');
    expect(record()).toContain('Notes: Wi-Fi dropped twice');
    await user.click(transfer.querySelector('button')!);
    expect(record()).toContain('SC-0415-03 transfer: not checked');
  });
});
