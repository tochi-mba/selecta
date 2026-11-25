import { describe, expect, it } from 'vitest';
import { capNames, keyNames } from './keycaps';

describe('keycaps that light while their key is held (ADR-0477)', () => {
  it('knows the words a keycap uses for a key', () => {
    expect(keyNames('Control')).toContain('ctrl');
    expect(keyNames('Escape')).toContain('esc');
    expect(keyNames(' ')).toContain('space');
    expect(keyNames('k')).toEqual(['k']);
  });

  it('lights a keycap that names a held key, and only that one', () => {
    expect(capNames('Ctrl K', new Set(['k']))).toBe(true);
    expect(capNames('Ctrl K', new Set(['Control']))).toBe(true);
    expect(capNames('?', new Set(['?']))).toBe(true);
    expect(capNames('Arrow keys', new Set(['ArrowDown']))).toBe(true);
    expect(capNames('Ctrl K', new Set(['j']))).toBe(false);
    expect(capNames('R', new Set())).toBe(false);
    expect(capNames('', new Set(['r']))).toBe(false);
  });
});
