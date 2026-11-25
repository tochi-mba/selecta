import { describe, expect, it } from 'vitest';
import { placeLine, placeOf, placeWords, rollPlace, sentMark } from './sent';

const item = (id: number, mine = true) => ({ song: { song_id: id }, mine });

describe('Sent on the guest page', () => {
  it('finds the place in the room’s own answer, coming up first, then waiting for the host', () => {
    expect(placeOf({ coming_up: [item(1, false), item(5)], waiting: [item(9)] }, [5, 9])).toEqual({ place: 2, list: 'coming' });
    expect(placeOf({ coming_up: [item(1, false)], waiting: [item(3, false), item(9)] }, [9])).toEqual({ place: 2, list: 'waiting' });
    // someone else's request for the same song is not this guest's place
    expect(placeOf({ coming_up: [item(9, false)], waiting: [] }, [9])).toBeNull();
    expect(placeOf({ coming_up: [], waiting: [] }, [9])).toBeNull();
  });

  it('says the place whole for a screen reader and hides the rolling number', () => {
    const line = placeLine({ place: 3, list: 'waiting' });
    expect(line.querySelector('.g-sr')?.textContent).toBe(placeWords({ place: 3, list: 'waiting' }));
    const number = line.querySelector('.g-place-number') as HTMLElement;
    expect(number.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(number.textContent).toBe('3');
  });

  it('leaves the final number in place when it cannot roll', () => {
    const line = placeLine({ place: 1, list: 'coming' });
    document.body.append(line);
    const number = line.querySelector<HTMLElement>('.g-place-number');
    rollPlace(number);
    expect(number?.textContent).toBe('1');
    line.remove();
  });

  it('draws the tick inside a decorative arc', () => {
    const mark = sentMark(document.createElement('i'));
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelector('.g-arc path')?.getAttribute('pathLength')).toBe('1');
  });
});
