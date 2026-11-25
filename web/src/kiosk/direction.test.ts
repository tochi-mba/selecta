import { describe, expect, it } from 'vitest';
import { screenDirection } from './direction';

describe('kiosk screen direction', () => {
  it('moves nothing on the first screen or a redraw of the same one', () => {
    expect(screenDirection(null, 'playing')).toBeNull();
    expect(screenDirection('playing', 'playing')).toBeNull();
  });

  it('comes in from ahead along the day and from behind going back', () => {
    expect(screenDirection('needs_tap', 'starting')).toBe('forward');
    expect(screenDirection('starting', 'playing')).toBe('forward');
    expect(screenDirection('playing', 'paused')).toBe('back');
    expect(screenDirection('playing', 'closed')).toBe('back');
    expect(screenDirection('paused', 'playing')).toBe('forward');
  });
});
