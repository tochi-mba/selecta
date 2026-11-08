import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefs, reloadPrefs } from '../state/prefs';
import { buildCommands, type CommandContext, matchCommands } from './commands';

function makeContext(change: Partial<CommandContext> = {}): CommandContext {
  const noOp = vi.fn();
  return {
    hasMix: true, playing: false, active: false, hasNext: false, canUndo: true,
    undoScope: 'Current mix: Evening', readySongs: 8, songsLeftToAnalyse: 0, analysing: false,
    drafts: [], theme: 'system', motion: 'subtle', togglePause: noOp, next: noOp,
    jump: noOp, toggleStage: noOp, openRequests: noOp, openActivity: noOp,
    openHelp: noOp, undo: noOp, startAnalysis: noOp, ...change,
  };
}

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
});

describe('contextual commands', () => {
  it('names the exact mix for Undo and refuses unloaded draft actions', () => {
    const undo = vi.fn();
    const commands = buildCommands(makeContext({ undo, undoScope: 'Draft: Friday', undoUnavailable: 'Wait for this draft to load.' }));
    const item = commands.find((command) => command.id === 'undo');
    expect(item?.detail).toBe('Draft: Friday');
    expect(item?.unavailable).toBe('Wait for this draft to load.');
    const ready = buildCommands(makeContext({ undo, undoScope: 'Draft: Friday' })).find((command) => command.id === 'undo');
    expect(ready?.unavailable).toBeUndefined();
    ready?.run();
    expect(undo).toHaveBeenCalledOnce();
  });

  it('offers only local motion changes and preserves the selected setting', () => {
    const commands = buildCommands(makeContext());
    const expressive = commands.find((command) => command.id === 'motion-expressive');
    expect(expressive).toBeDefined();
    expect(matchCommands(commands, 'motion expressive')).toContain(expressive);
    expressive?.run();
    expect(prefs().motion).toBe('expressive');
    expect(document.documentElement.dataset.motion).toBe('expressive');
    expect(buildCommands(makeContext({ motion: 'expressive' })).find((command) => command.id === 'motion-expressive')?.unavailable).toBeDefined();
  });
});
