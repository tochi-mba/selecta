import type { DraftInfo } from '../api';
import { navigate } from '../router';
import { setPrefs, Theme, Motion } from '../state/prefs';
import { DESTINATIONS, EXPLORE_TABS, WORKSPACE_TABS } from './manifest';

/** What the command palette can do. It's a shortcut to things that already have an ordinary way to do
 * them, and nothing here deletes anything or replaces what's playing. Anything that would only opens
 * the page where that choice is made, with its usual warning. A command that can't run right now says
 * why, rather than disappearing. */

export type Command = {
  id: string;
  label: string;
  group: 'Go to' | 'Playback' | 'Do' | 'Your drafts';
  /** Other words someone might search for. */
  keywords?: string;
  /** Why it can't run right now. */
  unavailable?: string;
  /** Scope of a mutation, so a draft cannot look like the current mix. */
  detail?: string;
  run: () => void;
};

export type CommandContext = {
  hasMix: boolean;
  playing: boolean;
  active: boolean;
  hasNext: boolean;
  canUndo: boolean;
  undoScope: string;
  undoUnavailable?: string;
  readySongs: number;
  songsLeftToAnalyse: number;
  analysing: boolean;
  drafts: Pick<DraftInfo, 'id' | 'name'>[];
  theme: Theme;
  motion: Motion;
  togglePause: () => void;
  next: () => void;
  jump: () => void;
  toggleStage: () => void;
  openRequests: () => void;
  openActivity: () => void;
  openHelp: () => void;
  undo: () => void;
  startAnalysis: () => void;
};

export function buildCommands(context: CommandContext): Command[] {
  const { hasMix, active, hasNext } = context;
  const noMix = 'Start a mix first.';
  const places: Command[] = [
    ...DESTINATIONS.map((place): Command => ({ id: `go-${place.id}`, label: place.label, group: 'Go to', keywords: place.about, run: () => navigate(place.path) })),
    ...EXPLORE_TABS.filter((tab) => tab.path !== '/mixes').map((tab): Command => ({ id: `go-${tab.path}`, label: tab.label, group: 'Go to', keywords: 'explore discover', run: () => navigate(tab.path) })),
    ...WORKSPACE_TABS.filter((tab) => tab.tab !== 'overview').map((tab): Command => ({ id: `go-${tab.path}`, label: `Workspace: ${tab.label}`, group: 'Go to', keywords: 'workshop settings', run: () => navigate(tab.path) })),
    { id: 'go-study', label: 'Listening study', group: 'Go to', keywords: 'blind test comparison', run: () => navigate('/listening') },
    { id: 'go-edit', label: 'Edit current mix', group: 'Go to', keywords: 'timeline change', unavailable: hasMix ? undefined : noMix, run: () => navigate('/mix/current/edit') },
  ];
  const playback: Command[] = [
    { id: 'play-pause', label: context.playing ? 'Pause' : 'Play', group: 'Playback', unavailable: hasMix ? undefined : noMix, run: context.togglePause },
    { id: 'next', label: 'Next song', group: 'Playback', keywords: 'skip', unavailable: !active ? 'Nothing is playing.' : hasNext ? undefined : 'This is the last song.', run: context.next },
    { id: 'jump', label: 'Jump to the transition', group: 'Playback', unavailable: !active ? 'Nothing is playing.' : hasNext ? undefined : 'This is the last song.', run: context.jump },
    { id: 'stage', label: 'Fullscreen lyrics', group: 'Playback', keywords: 'stage', unavailable: hasMix ? undefined : noMix, run: context.toggleStage },
  ];
  const actions: Command[] = [
    { id: 'request', label: 'Request a song', group: 'Do', run: context.openRequests },
    { id: 'new-mix', label: 'Start a new mix', group: 'Do', keywords: 'preset vibe', unavailable: context.readySongs >= 6 ? undefined : `Selecta needs 6 mix-ready songs, and has ${context.readySongs}.`, run: () => navigate('/mixes') },
    { id: 'undo', label: 'Undo the last change', group: 'Do', detail: context.undoScope, unavailable: context.undoUnavailable ?? (context.canUndo ? undefined : 'There’s nothing to undo.'), run: context.undo },
    { id: 'analyse', label: 'Analyse the rest of my library', group: 'Do', unavailable: context.analysing ? 'Analysis is already running.' : context.songsLeftToAnalyse ? undefined : 'Every song has been analysed.', run: context.startAnalysis },
    { id: 'activity', label: 'Activity and Undo', group: 'Do', keywords: 'history recent', run: context.openActivity },
    { id: 'help', label: 'Keyboard shortcuts', group: 'Do', keywords: 'keys help', run: context.openHelp },
    ...(['light', 'dark', 'system'] as Theme[]).map((theme): Command => ({
      id: `theme-${theme}`,
      label: theme === 'system' ? 'Theme: match this computer' : `Theme: ${theme}`,
      group: 'Do',
      keywords: 'appearance colour color mode',
      unavailable: context.theme === theme ? 'It’s already using that.' : undefined,
      run: () => setPrefs({ theme }),
    })),
    ...(['still', 'subtle', 'expressive'] as Motion[]).map((motion): Command => ({
      id: `motion-${motion}`,
      label: `Motion: ${motion}`,
      group: 'Do',
      keywords: 'animation movement accessibility visual intensity',
      detail: 'Local visual preference; reduced-motion setting takes priority',
      unavailable: context.motion === motion ? 'It’s already using that.' : undefined,
      run: () => setPrefs({ motion }),
    })),
  ];
  const drafts = context.drafts.map((draft): Command => ({
    id: `draft-${draft.id}`,
    label: `Edit draft: ${draft.name}`,
    group: 'Your drafts',
    // the address says which one, and if it's gone by then, that page says so and changes nothing
    run: () => navigate(`/mixes/drafts/${draft.id}/edit`),
  }));
  return [...places, ...playback, ...actions, ...drafts];
}

/** The best matches first. Each word has to appear somewhere. */
export function matchCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands
    .map((command) => {
      const label = command.label.toLowerCase();
      const text = `${label} ${command.keywords ?? ''} ${command.group}`.toLowerCase();
      if (!words.every((word) => text.includes(word))) return null;
      return { command, score: label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2 };
    })
    .filter((row): row is { command: Command; score: number } => row !== null)
    .sort((a, b) => a.score - b.score)
    .map((row) => row.command);
}
