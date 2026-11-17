import { describe, expect, it } from 'vitest';
import { timeStretch, STRETCH_IMPLEMENTATION } from './stretch';

describe('time stretch placeholder', () => {
  it('returns unsupported_here with its reason, never an error', () => {
    const result = timeStretch();
    expect(result.status).toBe('unsupported_here');
    expect(result.reason).toBe('no vetted pitch-preserving stretch is bundled');
    expect(result.implementation).toBe(STRETCH_IMPLEMENTATION);
  });

  it('does not pretend to be a stretch implementation', () => {
    expect(STRETCH_IMPLEMENTATION).toContain('unsupported');
  });
});
