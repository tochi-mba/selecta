import { describe, expect, it } from 'vitest';
import { pickerOrder, telling, whereToPlay, whyNot, type Candidate, type Situation } from './whereToPlay';

// ADR-0475: which device plays when one must be chosen, row by row.

const device = (device_id: string, over: Partial<Candidate> = {}): Candidate => ({ device_id, name: device_id, online: true, songs: 10, last_seen_at: 100, reported_at: 50, ...over });
const IDS = new Map<string, ReadonlySet<number>>([
  ['laptop', new Set([1, 2, 3, 4])], ['phone', new Set([1, 2])], ['tablet', new Set([9])], ['old', new Set([1, 2, 3, 4])],
]);
const at = (over: Partial<Situation>): Situation => ({ devices: [], speaker: null, defaultId: null, thisDeviceId: null, mixIds: [1, 2, 3, 4], ids: IDS, ...over });
const kindOf = (situation: Situation) => whereToPlay(situation).kind;

describe('the rule, row by row', () => {
  const laptop = device('laptop');
  const phone = device('phone', { last_seen_at: 200 });
  it.each([
    ['the session speaker online wins over everything', at({ devices: [laptop, phone], speaker: { deviceId: 'phone', online: true }, defaultId: 'laptop' }), 'speaker'],
    ['a speaker that is offline does not count', at({ devices: [laptop], speaker: { deviceId: 'phone', online: false } }), 'only'],
    ['the default online with some of the mix wins, even with another holding all', at({ devices: [laptop, phone], defaultId: 'phone' }), 'default'],
    ['the default holding none of this mix is not usable', at({ devices: [laptop, phone, device('tablet')], defaultId: 'tablet' }), 'ask'],
    ['the default not open, one other online: that one', at({ devices: [laptop, device('phone', { online: false })], defaultId: 'phone' }), 'only'],
    ['two online with music and no default: ask', at({ devices: [laptop, phone] }), 'ask'],
    ['a device whose folder needs allowing again is not usable', at({ devices: [laptop, device('phone', { needsFolder: true })] }), 'only'],
    ['nobody with music open: none', at({ devices: [device('laptop', { online: false })] }), 'none'],
    ['no devices at all: none', at({ devices: [] }), 'none'],
  ])('%s', (_name, situation, kind) => {
    expect(kindOf(situation)).toBe(kind);
  });

  it('the default with part of the mix names the device that has all of it', () => {
    const choice = whereToPlay(at({ devices: [laptop, phone], defaultId: 'phone' }));
    expect(choice).toMatchObject({ kind: 'default', held: 2, whole: { device_id: 'laptop' } });
  });

  it('the default away is said, and the one that plays is named', () => {
    const choice = whereToPlay(at({ devices: [laptop, device('phone', { online: false })], defaultId: 'phone' }));
    expect(choice).toMatchObject({ kind: 'only', device: { device_id: 'laptop' }, defaultAway: { device_id: 'phone' } });
  });
});

describe('the picker', () => {
  it('orders by most of the mix, then this device, then most recently active, unusable last; one Suggested', () => {
    const situation = at({
      devices: [device('phone', { last_seen_at: 300 }), device('laptop', { last_seen_at: 10 }), device('old', { last_seen_at: 400 }), device('tablet', { needsFolder: true })],
      thisDeviceId: 'laptop',
    });
    const options = pickerOrder(situation);
    // laptop and old tie on all four songs: this device first
    expect(options.map((option) => option.device.device_id)).toEqual(['laptop', 'old', 'phone', 'tablet']);
    expect(options.at(-1)).toMatchObject({ usable: false, why: 'tablet needs its music folder allowed again.' });
    const choice = whereToPlay(situation);
    expect(choice).toMatchObject({ kind: 'ask', suggested: 'laptop' });
  });

  it('says why a device cannot be chosen', () => {
    const situation = at({});
    expect(whyNot(device('x', { online: false }), situation)).toBe('x isn’t open right now.');
    expect(whyNot(device('x', { songs: 0 }), situation)).toBe('x has no music connected.');
    expect(whyNot(device('tablet'), situation)).toBe('tablet has none of these songs.');
  });

  it('tells two devices with the same name apart', () => {
    const one = device('a', { name: 'Chrome on Android', last_seen_at: 1000 });
    const two = device('b', { name: 'Chrome on Android', last_seen_at: 1000 - 600 });
    expect(telling(one, [one, two], 'a', 1000)).toBe('This device');
    expect(telling(two, [one, two], 'a', 1000)).toBe('Last seen 10 minutes ago');
    expect(telling(device('c', { name: 'Unique' }), [one, two], 'a', 1000)).toBeNull();
  });
});
