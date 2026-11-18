import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixItem } from '../api';
import type { NowState } from '../player';
import { reloadPrefs } from '../state/prefs';
import { SHORTCUTS } from '../state/shortcuts';
import { buildCommands, buildServerFreeCommands, SERVER_FREE_SHORTCUTS } from './commands';
import { useMediaKeys } from './useMediaKeys';

// W5: the pieces a shell without this computer's server (hosted Cloud) reuses: a command subset that
// never asks a server, and the media keys as a hook rather than code inside App.

const places = [{ id: 'home', label: 'Home', path: '/' }, { id: 'library', label: 'Library', path: '/library', about: 'your songs' }];

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  window.history.replaceState({}, '', '/');
});

describe('server-free commands', () => {
  it('offers only its own places, help, the glossary, theme and motion', () => {
    const ids = buildServerFreeCommands({ places, theme: 'system', motion: 'subtle', openHelp: vi.fn() }).map((command) => command.id);
    expect(ids).toEqual(expect.arrayContaining(['go-home', 'go-library', 'help', 'glossary', 'theme-light', 'theme-dark', 'motion-still']));
    for (const local of ['undo', 'analyse', 'new-mix', 'request', 'activity', 'go-edit', 'stage', 'play-pause', 'next']) expect(ids).not.toContain(local);
    expect(ids.some((id) => id.startsWith('draft-'))).toBe(false);
  });

  it('goes to the place a shell names, by its own path', () => {
    const library = buildServerFreeCommands({ places, theme: 'system', motion: 'subtle' }).find((command) => command.id === 'go-library');
    library?.run();
    expect(window.location.pathname).toBe('/library');
    expect(library?.keywords).toBe('your songs');
  });

  it('leaves Keyboard shortcuts out when the shell has no list to open', () => {
    expect(buildServerFreeCommands({ places, theme: 'system', motion: 'subtle' }).map((command) => command.id)).not.toContain('help');
  });

  it('adds play, pause and next only for a shell with a player of its own, and says why they wait', () => {
    const togglePause = vi.fn();
    const commands = buildServerFreeCommands({ places, theme: 'system', motion: 'subtle', transport: { ready: false, playing: false, hasNext: false, togglePause, next: vi.fn() } });
    expect(commands.find((command) => command.id === 'play-pause')?.unavailable).toBe('Nothing to play yet.');
    expect(commands.find((command) => command.id === 'next')?.unavailable).toBe('This is the last song.');
    const playing = buildServerFreeCommands({ places, theme: 'system', motion: 'subtle', transport: { ready: true, playing: true, hasNext: true, togglePause } });
    const pause = playing.find((command) => command.id === 'play-pause');
    expect(pause?.label).toBe('Pause');
    pause?.run();
    expect(togglePause).toHaveBeenCalledOnce();
    expect(playing.map((command) => command.id)).not.toContain('next');
  });

  it('shares its browser-only commands with the full list, unchanged', () => {
    const noOp = vi.fn();
    const full = buildCommands({
      hasMix: true, playing: false, active: false, hasNext: false, canUndo: true, undoScope: 'Current mix', readySongs: 8,
      songsLeftToAnalyse: 0, analysing: false, drafts: [], theme: 'dark', motion: 'still', togglePause: noOp, next: noOp,
      jump: noOp, toggleStage: noOp, openRequests: noOp, openActivity: noOp, openHelp: noOp, undo: noOp, startAnalysis: noOp,
    });
    const free = buildServerFreeCommands({ places, theme: 'dark', motion: 'still', openHelp: noOp });
    const shape = (id: string, list: typeof full) => {
      const { run: _run, ...rest } = list.find((command) => command.id === id)!;
      return rest;
    };
    for (const id of ['help', 'glossary', 'theme-dark', 'theme-light', 'motion-still', 'motion-expressive']) expect(shape(id, free)).toEqual(shape(id, full));
  });

  it('keeps the transport keys, the palette and the list, and nothing that reaches a server', () => {
    const known = new Set(SHORTCUTS.map((shortcut) => shortcut.id));
    for (const id of SERVER_FREE_SHORTCUTS) expect(known.has(id)).toBe(true);
    for (const local of ['search', 'request', 'undo', 'stage'] as const) expect(SERVER_FREE_SHORTCUTS.has(local)).toBe(false);
  });
});

describe('useMediaKeys', () => {
  const song: MixItem = { position: 0, song_id: 3, title: 'Morning', artist: 'Ada', duration: 120, bpm: null, key: null, locked: false, seam: null };
  const now = (phase: NowState['phase']): NowState => ({ phase, position: 0, songTime: 10, duration: 120, inSeam: false, seamAt: null, notice: '', nextReady: true, lastSeamKey: null, volume: 1, muted: false });
  let handlers: Map<string, unknown>;
  let session: { metadata: unknown; playbackState: string; setActionHandler: ReturnType<typeof vi.fn>; setPositionState: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    handlers = new Map();
    session = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn((action: string, handler: unknown) => { if (handler) handlers.set(action, handler); else handlers.delete(action); }),
      setPositionState: vi.fn(),
    };
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
  });
  afterEach(() => {
    delete (navigator as { mediaSession?: unknown }).mediaSession;
  });

  const player = (phase: NowState['phase']) => ({ state: now(phase), togglePause: vi.fn(async () => {}), next: vi.fn(async () => {}), previous: vi.fn(async () => {}), seek: vi.fn(async () => {}) });

  it('registers the keys while on, says what is playing, and lets go when off', () => {
    const playing = player('playing');
    const { rerender, unmount } = renderHook((props: { on: boolean }) => useMediaKeys({ on: props.on, player: playing, getMix: () => [song], mixName: 'Evening', now: playing.state }), { initialProps: { on: true } });
    expect([...handlers.keys()]).toEqual(expect.arrayContaining(['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']));
    expect(session.playbackState).toBe('playing');
    rerender({ on: false });
    expect(handlers.size).toBe(0);
    expect(session.playbackState).toBe('none');
    unmount();
  });

  it('does nothing for a shell with no player', () => {
    renderHook(() => useMediaKeys({ on: true, player: null, getMix: () => [], mixName: '', now: { phase: 'idle', position: 0 } }));
    expect(session.setActionHandler).not.toHaveBeenCalled();
  });

  it('the pause key acts on the live player state', () => {
    const live = player('playing');
    renderHook(() => useMediaKeys({ on: true, player: live, getMix: () => [song], mixName: 'Evening', now: live.state }));
    (handlers.get('pause') as () => void)();
    expect(live.togglePause).toHaveBeenCalledOnce();
  });
});
