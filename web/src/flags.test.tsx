import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { problemKind, ApiError } from './api';
import { Flag, FLAG_IDS, flagOn, gateOpen, REGISTRY, setFlags, visible } from './flags';
import { parseRoute } from './router';
import { buildCommands, CommandContext } from './shell/commands';
import { aboutOf, classicDestinations, exploreTabs, routeOn, shownRoute, workspaceTabs } from './shell/manifest';
import { PageLink } from './shell/PageLink';
import { shortcutFor, shortcutsOn, SHORTCUTS } from './state/shortcuts';
import { LinkTabs } from './ui/primitives';

const allOn = Object.fromEntries(FLAG_IDS.map((id) => [id, true]));
const without = (...off: string[]) => ({ ...allOn, ...Object.fromEntries(off.map((id) => [id, false])) });

const context = (): CommandContext => ({
  hasMix: true, playing: false, active: true, hasNext: true, canUndo: true, undoScope: 'Current mix',
  readySongs: 20, songsLeftToAnalyse: 0, analysing: false, drafts: [{ id: 3, name: 'Sunday' }],
  theme: 'system', motion: 'subtle',
  togglePause: () => {}, next: () => {}, jump: () => {}, toggleStage: () => {}, openRequests: () => {},
  openActivity: () => {}, openHelp: () => {}, undo: () => {}, startAnalysis: () => {},
});

const key = (key: string, more: Partial<KeyboardEvent> = {}) =>
  ({ key, code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`, target: document.body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more }) as KeyboardEvent;

describe('feature flags', () => {
  it('counts every flag as on when the server hasn’t said, as an older one won’t', () => {
    setFlags(null);
    expect(FLAG_IDS.every(flagOn)).toBe(true);
    setFlags({ requests: false });
    expect(flagOn('requests')).toBe(false);
    expect(flagOn('drafts')).toBe(true);
  });

  it('reads the same registry the server does', () => {
    expect(REGISTRY['requests.bridges'].requires).toEqual(['requests']);
    expect(REGISTRY['core.playback'].core).toBeTruthy();
    expect(FLAG_IDS.length).toBeGreaterThan(80);
  });

  it('opens a gate only when every flag it needs is on, and one of any it can use', () => {
    setFlags(without('workspace.storage'));
    expect(gateOpen({ flag: ['drafts', 'editor'] })).toBe(true);
    expect(gateOpen({ anyFlag: ['workspace.storage', 'workspace.backup'] })).toBe(true);
    setFlags(without('workspace.storage', 'workspace.backup'));
    expect(gateOpen({ anyFlag: ['workspace.storage', 'workspace.backup'] })).toBe(false);
    expect(visible([{ name: 'a' }, { name: 'b', flag: 'workspace.storage' as const }])).toEqual([{ name: 'a' }]);
  });

  it('renders a region or nothing at all', () => {
    setFlags(without('requests'));
    const { container } = render(<div><Flag id="requests"><p>asked</p></Flag><Flag id="drafts"><p>kept</p></Flag></div>);
    expect(container.textContent).toBe('kept');
  });
});

describe('the shell with features turned off', () => {
  it('drops a Make a Mix tab that’s off, and with one tab left there are no tabs', () => {
    setFlags(without('discover.harmonic'));
    expect(exploreTabs().map((tab) => tab.label)).toEqual(['Mix ideas', 'Word connections']);
    setFlags(without('discover.harmonic', 'discover.word_links'));
    expect(exploreTabs()).toHaveLength(1);
    const { container } = render(<LinkTabs label="Make a Mix" items={exploreTabs()} current="/mixes" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a Workspace tab while anything is left in it', () => {
    setFlags(without('workspace.storage'));
    expect(workspaceTabs().map((tab) => tab.tab)).toContain('storage');
    setFlags(without('workspace.storage', 'workspace.backup', 'workspace.diagnostics', 'library.folders'));
    expect(workspaceTabs().map((tab) => tab.tab)).toEqual(['overview', 'analysis', 'learning']);
  });

  it('shows Not Found for a page that’s off, as if it had never been built', () => {
    setFlags(without('lucy', 'listening_study', 'drafts'));
    expect(routeOn(parseRoute('/mixes/lucy'))).toBe(false);
    expect(shownRoute(parseRoute('/listening')).page).toBe('missing');
    expect(routeOn(parseRoute('/mixes/drafts/4/edit'))).toBe(false);
    expect(routeOn(parseRoute('/mix/current/edit'))).toBe(true);
    expect(routeOn(parseRoute('/workshop/storage'))).toBe(true);
  });

  it('sends classic Discover to whichever of its pages is there', () => {
    setFlags(without('discover.word_links'));
    expect(classicDestinations().find((item) => item.label === 'Discover')?.path).toBe('/discover/harmonic');
    setFlags(without('discover.word_links', 'discover.harmonic'));
    expect(classicDestinations().map((item) => item.label)).not.toContain('Discover');
  });

  it('describes each destination by only what it holds', () => {
    expect(aboutOf('mine')).toBe('Your current mix, your drafts and the render line');
    setFlags(without('render_line'));
    expect(aboutOf('mine')).toBe('Your current mix, your drafts');
    setFlags(without('drafts', 'render_line'));
    expect(aboutOf('mine')).toBe('Your current mix');
    setFlags(without('library.folders', 'workspace.storage', 'learning.memory', 'listening_study', 'workspace.diagnostics'));
    expect(aboutOf('workspace')).toBe('Analysis');
  });

  it('doesn’t draw a link to a page that’s off, and says so to whoever drew it', () => {
    setFlags(without('lucy'));
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<p>Start <PageLink to="/mixes/lucy">with Lucy</PageLink><PageLink to="/library">Library</PageLink></p>);
    expect(screen.queryByText('with Lucy')).toBeNull();
    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    expect(said).toHaveBeenCalledWith(expect.stringContaining('/mixes/lucy'));
    said.mockRestore();
  });
});

describe('commands and keys with features turned off', () => {
  it('offers no command for a feature that’s off', () => {
    setFlags(without('requests', 'lucy', 'app.glossary', 'drafts', 'app.theme_choice'));
    const ids = buildCommands(context()).map((command) => command.id);
    expect(ids).not.toContain('request');
    expect(ids).not.toContain('go-lucy');
    expect(ids).not.toContain('glossary');
    expect(ids).not.toContain('draft-3');
    expect(ids.some((id) => id.startsWith('theme-'))).toBe(false);
    expect(ids).toContain('play-pause');
  });

  it('leaves a key whose feature is off to the browser, and out of the help', () => {
    setFlags(without('requests'));
    expect(shortcutFor(key('r'))).toBeNull();
    expect(shortcutFor(key('m'))).toBe('mute');
    expect(shortcutsOn().map((shortcut) => shortcut.id)).not.toContain('request');
    setFlags(without('app.shortcuts'));
    expect(shortcutFor(key('m'))).toBeNull();
    expect(shortcutsOn().map((shortcut) => shortcut.id)).toEqual(['palette']);
  });

  it('gives every shortcut a flag, so none is left behind when its feature goes', () => {
    expect(SHORTCUTS.every((shortcut) => shortcut.flag !== undefined)).toBe(true);
  });

  it('reads a server’s refusal of something turned off as its own kind of problem', () => {
    expect(problemKind(new ApiError('off', 403, 'flag_off'))).toBe('off');
    expect(problemKind(new ApiError('no', 403, ''))).toBe('invalid');
  });
});
