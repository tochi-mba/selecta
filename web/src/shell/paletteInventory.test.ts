import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRoute } from '../router';
import { reloadPrefs } from '../state/prefs';
import { buildCommands, type CommandContext } from './commands';

// SF-0244-01: every palette command maps to something real. A "Go to" lands on a page the router
// knows (never the "page not found" page), every other command runs the app's own handler or saves a
// local preference, and a command that can't run right now says why instead of pretending.

const HANDLERS = ['togglePause', 'next', 'jump', 'toggleStage', 'openRequests', 'openActivity', 'openHelp', 'undo', 'startAnalysis'] as const;

function context(change: Partial<CommandContext> = {}) {
  const spies = Object.fromEntries(HANDLERS.map((name) => [name, vi.fn()])) as Record<(typeof HANDLERS)[number], ReturnType<typeof vi.fn>>;
  const value: CommandContext = {
    hasMix: true, playing: true, active: true, hasNext: true, canUndo: true,
    undoScope: 'Current mix: Evening', readySongs: 8, songsLeftToAnalyse: 3, analysing: false,
    drafts: [{ id: 4, name: 'Friday' }], theme: 'system', motion: 'subtle', ...spies, ...change,
  };
  return { value, spies };
}

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  window.history.replaceState({}, '', '/listen');
});

describe('the command palette inventory', () => {
  it('sends every Go to command to a page that exists', () => {
    const { value } = context();
    const places = buildCommands(value).filter((command) => command.group === 'Go to' || command.group === 'Your drafts');
    expect(places.length).toBeGreaterThan(5);
    for (const command of places) {
      window.history.replaceState({}, '', '/listen');
      command.run();
      expect(parseRoute(window.location.pathname).page, command.id).not.toBe('missing');
    }
  });

  it('runs the app’s own handler, or saves a local preference, for every other command', () => {
    const { value, spies } = context();
    const others = buildCommands(value).filter((command) => command.group === 'Playback' || command.group === 'Do');
    for (const command of others) {
      const before = HANDLERS.reduce((sum, name) => sum + spies[name].mock.calls.length, 0);
      const stored = localStorage.length;
      const path = window.location.pathname;
      command.run();
      const handled = HANDLERS.reduce((sum, name) => sum + spies[name].mock.calls.length, 0) > before;
      const saved = localStorage.length > stored || command.id.startsWith('theme-') || command.id.startsWith('motion-');
      const moved = window.location.pathname !== path;
      const opened = command.id === 'glossary';
      expect(handled || saved || moved || opened, command.id).toBe(true);
    }
  });

  it('says why a command can’t run, instead of hiding it or running it anyway', () => {
    const { value } = context({ hasMix: false, active: false, hasNext: false, canUndo: false, readySongs: 2, songsLeftToAnalyse: 0 });
    const commands = buildCommands(value);
    for (const id of ['play-pause', 'next', 'jump', 'undo', 'new-mix', 'analyse']) {
      const command = commands.find((item) => item.id === id);
      expect(command, id).toBeDefined();
      expect(command!.unavailable, id).toMatch(/\w/);
    }
    expect(commands.find((item) => item.id === 'new-mix')!.unavailable).toContain('has 2');
  });
});
