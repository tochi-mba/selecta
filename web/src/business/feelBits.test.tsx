import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useWorkProfile } from './feelBits';

// The calm profile (ADR-0477 plan 3.14): Business, Admin and the venue staff screens mark <html> so
// their sheets keep the ambient layer, beat targets and celebrations out.
describe('useWorkProfile', () => {
  afterEach(() => {
    delete document.documentElement.dataset.feelProfile;
    document.querySelectorAll('.ambient-layer').forEach((layer) => layer.remove());
  });

  it('marks <html> while a work tool is open and clears it when the last one closes', () => {
    const first = renderHook(() => useWorkProfile());
    const second = renderHook(() => useWorkProfile());
    expect(document.documentElement.dataset.feelProfile).toBe('work');
    first.unmount();
    expect(document.documentElement.dataset.feelProfile).toBe('work');
    second.unmount();
    expect(document.documentElement.dataset.feelProfile).toBeUndefined();
  });

  it('never adds an ambient layer of its own', () => {
    const view = renderHook(() => useWorkProfile());
    expect(document.querySelector('.ambient-layer')).toBeNull();
    view.unmount();
  });
});
