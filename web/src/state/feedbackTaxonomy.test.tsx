import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, problemKind } from '../api';
import { Status, StatusKind } from '../ui/controls';

// SF-0232-01: success, pending, blocked, failed and conflict are distinct states, each with its own
// words and its own mark (never colour alone), and a server conflict is never read as a failure.
// The full inventory is in docs/engineering/flow-cross-cutting.md.

function shown(kind: StatusKind) {
  const { container, unmount } = render(<Status kind={kind} />);
  const badge = container.querySelector(`.status-${kind}`);
  const result = { words: badge?.textContent ?? '', mark: badge?.querySelector('svg')?.getAttribute('data-icon') ?? '' };
  unmount();
  return result;
}

describe('the feedback taxonomy', () => {
  it('gives success, pending, blocked, failed and needs-you states different words and marks', () => {
    const families: Record<string, StatusKind> = { success: 'ready', pending: 'queued', working: 'working', blocked: 'blocked', failed: 'failed', needsYou: 'needs-action' };
    const seen = Object.values(families).map(shown);
    for (const state of seen) {
      expect(state.words).not.toBe('');
      expect(state.mark).not.toBe('');
    }
    expect(new Set(seen.map((state) => state.words)).size).toBe(seen.length);
    // success, pending, failed and needs-you never share a mark; blocked shares the warning mark
    // with "Ready, with a warning", and its words keep them apart
    const marks = [families.success, families.pending, families.failed, families.needsYou].map((kind) => shown(kind).mark);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('tells a conflict from a failure, a missing thing, a refusal and a stopped server', () => {
    expect(problemKind(new ApiError('The mix moved on', 409))).toBe('conflict');
    expect(problemKind(new ApiError('Not Found', 404))).toBe('missing');
    expect(problemKind(new ApiError('Bad value', 422))).toBe('invalid');
    expect(problemKind(new ApiError('Broke', 500))).toBe('server');
    expect(problemKind(new ApiError('Off', 404, 'flag_off'))).toBe('off');
    expect(problemKind(new ApiError('Full', 507, 'storage_full'))).toBe('storage');
    expect(problemKind(new Error('Can’t reach SelectaDJ right now.'))).toBe('offline');
  });
});
