import { afterEach, describe, expect, it, vi } from 'vitest';

// Plan 3.4: a song chosen from the queue sends its cover to the hero, and the Stage travel's moves.

const feel = vi.hoisted(() => ({ on: true, calm: false }));
vi.mock('../feel/root', () => ({ feelOn: () => feel.on, feelCalm: () => feel.calm }));

import { COVER_WAIT_MS, sendCoverToHero, takeCoverFor } from './coverToHero';
import { fillFrom, travelFrom } from './stageTravel';

const cover = (left: number, top: number, size: number) => ({
  getBoundingClientRect: () => ({ left, top, width: size, height: size }),
}) as unknown as Element;

afterEach(() => {
  feel.on = true;
  feel.calm = false;
  takeCoverFor(-1, Number.MAX_SAFE_INTEGER);
});

describe('the queue cover travelling to the hero', () => {
  it('is kept for the song pressed, through another song arriving first, and taken once', () => {
    sendCoverToHero(cover(10, 400, 40), 7, 1000);
    expect(takeCoverFor(3, 1500)).toBeNull();
    expect(takeCoverFor(7, 2000)).toMatchObject({ left: 10, top: 400, width: 40 });
    expect(takeCoverFor(7, 2100)).toBeNull();
  });

  it('is forgotten when the song does not start in time', () => {
    sendCoverToHero(cover(10, 400, 40), 7, 1000);
    expect(takeCoverFor(7, 1000 + COVER_WAIT_MS + 1)).toBeNull();
  });

  it('is never noted with motion calm or off', () => {
    feel.calm = true;
    sendCoverToHero(cover(10, 400, 40), 7, 1000);
    expect(takeCoverFor(7, 1001)).toBeNull();
    feel.calm = false;
    feel.on = false;
    sendCoverToHero(cover(10, 400, 40), 7, 1000);
    expect(takeCoverFor(7, 1001)).toBeNull();
  });
});

describe('the Stage travel', () => {
  it('moves a box back to where it was, at its old size', () => {
    expect(travelFrom({ left: 10, top: 400, width: 40, height: 40 }, { left: 50, top: 100, width: 200, height: 200 })).toBe('translate(-40.0px, 300.0px) scale(0.200)');
  });

  it('fills the window from a box, centred', () => {
    expect(fillFrom({ left: 0, top: 0, width: 100, height: 100 }, { width: 1000, height: 500 })).toBe('translate(450.0px, 200.0px) scale(10.000)');
  });
});
