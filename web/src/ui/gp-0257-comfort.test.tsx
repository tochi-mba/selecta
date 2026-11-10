import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityEntries } from '../state/activity';
import { announce, LiveRegion } from './controls';
import { clearToasts, setToastsQuiet, showProblem, showToast, Toaster } from './toasts';

/** GP-0257: a long session stays calm. Routine news is said once, in Activity if not on screen;
 * problems and anything with an Undo always reach the listener. */

const SRC = join(__dirname, '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

afterEach(() => {
  act(() => clearToasts());
  vi.useRealTimers();
});

const shown = () => [...document.body.querySelectorAll('.toast-row')].map((row) => row.textContent ?? '');

describe('GP-0257 notification budget', () => {
  it('GP-0257-01 counts the foreground messages by severity, and every problem goes through the problem tone', () => {
    const counts = { info: 0, undo: 0, problem: 0 };
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      counts.problem += (text.match(/showProblem\(|tone: 'problem'/g) ?? []).length;
      counts.undo += (text.match(/notify\([^;]*\{ undo|showToast\([^;]*undo:/g) ?? []).length;
      counts.info += (text.match(/\bnotify\(|showToast\(/g) ?? []).length;
    }
    console.log(`GP-0257-01 foreground message call sites: ${JSON.stringify(counts)}`);
    expect(counts.problem).toBeGreaterThan(0);
    expect(counts.info).toBeGreaterThan(counts.problem);
  });

  it('GP-0257-02 routine news is shown once a while, at most three at a time, and never on the Stage', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(<Toaster />);
    act(() => { showToast('Analysing in the background.'); });
    act(() => { showToast('Analysing in the background.'); });
    expect(shown()).toHaveLength(1);
    act(() => clearToasts());
    act(() => { for (const word of ['One.', 'Two.', 'Three.', 'Four.']) showToast(word); });
    expect(shown()).toHaveLength(3);
    act(() => { setToastsQuiet(true); });
    expect(shown()).toHaveLength(0);
    act(() => { showToast('Saved.'); });
    expect(shown()).toHaveLength(0);
    // a real problem still interrupts, even on the Stage
    act(() => { showProblem('Couldn’t save the transition.'); });
    expect(shown()).toEqual([expect.stringContaining('Couldn’t save the transition.')]);
    act(() => { setToastsQuiet(false); });
  });

  it('GP-0257-03 a repeat is condensed in the foreground but its details are kept once in Activity', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(<Toaster />);
    act(() => { for (let index = 0; index < 5; index += 1) showToast('Found 2 new songs. Analysing them now.'); });
    expect(shown()).toHaveLength(1);
    expect(activityEntries().filter((entry) => entry.message === 'Found 2 new songs. Analysing them now.')).toHaveLength(1);
    // after the quiet window it can be said again
    vi.setSystemTime(Date.now() + 31_000);
    act(() => clearToasts());
    act(() => { showToast('Found 2 new songs. Analysing them now.'); });
    expect(shown()).toHaveLength(1);
  });

  it('GP-0257-06 the live region does not repeat the same words within a few seconds', async () => {
    vi.useFakeTimers();
    render(<LiveRegion />);
    const region = screen.getByRole('status');
    act(() => { announce('Playing Song 2.'); vi.advanceTimersByTime(40); });
    expect(region).toHaveTextContent('Playing Song 2.');
    act(() => { announce('Something else.'); vi.advanceTimersByTime(40); });
    expect(region).toHaveTextContent('Something else.');
    act(() => { announce('Something else.'); vi.advanceTimersByTime(40); });
    act(() => { announce('Something else.'); vi.advanceTimersByTime(40); });
    expect(region).toHaveTextContent('Something else.');
    let changes = 0;
    const watcher = new MutationObserver(() => { changes += 1; });
    watcher.observe(region, { childList: true, characterData: true, subtree: true });
    act(() => { announce('Something else.'); vi.advanceTimersByTime(40); });
    await Promise.resolve();
    watcher.disconnect();
    expect(changes).toBe(0);
  });

  it('GP-0257-07 quiet work and failures stay findable in Activity even when nothing pops up', () => {
    render(<Toaster />);
    act(() => { setToastsQuiet(true); });
    act(() => { showToast('Rendered 3 transitions.'); showProblem('An export failed: not enough space.'); });
    act(() => { setToastsQuiet(false); });
    const kept = activityEntries().map((entry) => [entry.message, entry.tone]);
    expect(kept).toEqual(expect.arrayContaining([['Rendered 3 transitions.', 'info'], ['An export failed: not enough space.', 'problem']]));
    expect(shown()).toEqual([expect.stringContaining('An export failed')]);
  });
});
