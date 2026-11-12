import type { DraftInfo } from '../api';
import { FlagId, visible } from '../flags';
import { navigate } from '../router';
import { openGlossary } from '../state/glossaryRequests';
import { setPrefs, Theme, Motion } from '../state/prefs';
import { aboutOf, DESTINATIONS, exploreTabs, workspaceTabs } from './manifest';
import { words } from '../copy';

/** What the command palette can do. It's a shortcut to things that already have an ordinary way to do
 * them, and nothing here deletes anything or replaces what's playing. Anything that would only opens
 * the page where that choice is made, with its usual warning. A command that can't run right now says
 * why, rather than disappearing. One whose feature isn't in this build isn't there at all. */

export type Command = {
  id: string;
  label: string;
  group: 'Songs' | 'Go to' | 'Playback' | 'Do' | 'Your drafts';
  /** Other words someone might search for. */
  keywords?: string;
  /** Why it can't run right now. */
  unavailable?: string;
  /** Scope of a mutation, so a draft cannot look like the current mix. */
  detail?: string;
  /** The features it needs. Without them it isn't offered. */
  flag?: FlagId | FlagId[];
  anyFlag?: FlagId[];
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
    ...DESTINATIONS.map((place): Command => ({ id: `go-${place.id}`, label: place.label, group: 'Go to', keywords: aboutOf(place.id), run: () => navigate(place.path) })),
    ...exploreTabs().filter((tab) => tab.path !== '/mixes').map((tab): Command => ({ id: `go-${tab.path}`, label: tab.label, group: 'Go to', keywords: 'explore discover', run: () => navigate(tab.path) })),
    ...workspaceTabs().filter((tab) => tab.tab !== 'overview').map((tab): Command => ({ id: `go-${tab.path}`, label: `Workspace: ${tab.label}`, group: 'Go to', keywords: 'workshop settings', run: () => navigate(tab.path) })),
    { id: 'go-lucy', label: 'Make a mix with Lucy', group: 'Go to', keywords: 'lucy chat describe plan assistant conversation', flag: 'lucy', run: () => navigate('/mixes/lucy') },
    { id: 'go-study', label: 'Listening study', group: 'Go to', keywords: 'blind test comparison', flag: 'listening_study', run: () => navigate('/listening') },
    { id: 'go-edit', label: 'Edit current mix', group: 'Go to', keywords: 'timeline change', flag: 'editor', unavailable: hasMix ? undefined : noMix, run: () => navigate('/mix/current/edit') },
  ];
  const playback: Command[] = [
    { id: 'play-pause', label: context.playing ? 'Pause' : 'Play', group: 'Playback', unavailable: hasMix ? undefined : noMix, run: context.togglePause },
    { id: 'next', label: 'Next song', group: 'Playback', keywords: 'skip', unavailable: !active ? 'Nothing is playing.' : hasNext ? undefined : 'This is the last song.', run: context.next },
    { id: 'jump', label: 'Jump to the transition', group: 'Playback', unavailable: !active ? 'Nothing is playing.' : hasNext ? undefined : 'This is the last song.', run: context.jump },
    { id: 'stage', label: 'Fullscreen lyrics', group: 'Playback', keywords: 'stage', flag: 'listen.stage', unavailable: hasMix ? undefined : noMix, run: context.toggleStage },
  ];
  const actions: Command[] = [
    { id: 'request', label: 'Request a song', group: 'Do', flag: 'requests', run: context.openRequests },
    { id: 'new-mix', label: 'Start a new mix', group: 'Do', keywords: 'preset vibe', unavailable: context.readySongs >= 6 ? undefined : `SelectaDJ needs 6 mix-ready songs, and has ${context.readySongs}.`, run: () => navigate('/mixes') },
    { id: 'undo', label: 'Undo the last change', group: 'Do', detail: context.undoScope, unavailable: context.undoUnavailable ?? (context.canUndo ? undefined : 'There’s nothing to undo.'), run: context.undo },
    { id: 'analyse', label: 'Analyse the rest of my library', group: 'Do', unavailable: context.analysing ? 'Analysis is already running.' : context.songsLeftToAnalyse ? undefined : 'Every song has been analysed.', run: context.startAnalysis },
    { id: 'activity', label: 'Activity and Undo', group: 'Do', keywords: 'history recent', flag: 'app.activity', run: context.openActivity },
    { id: 'help', label: 'Keyboard shortcuts', group: 'Do', keywords: 'keys help', flag: 'app.shortcuts', run: context.openHelp },
    { id: 'glossary', label: 'Music terms (glossary)', group: 'Do', keywords: 'help glossary words meaning definitions explain what is', flag: 'app.glossary', run: () => openGlossary() },
    ...(['light', 'dark', 'system'] as Theme[]).map((theme): Command => ({
      id: `theme-${theme}`,
      label: theme === 'system' ? words().themeCommand : `Theme: ${theme}`,
      group: 'Do',
      keywords: 'appearance colour color mode',
      flag: 'app.theme_choice',
      unavailable: context.theme === theme ? 'It’s already using that.' : undefined,
      run: () => setPrefs({ theme }),
    })),
    ...(['still', 'subtle', 'expressive'] as Motion[]).map((motion): Command => ({
      id: `motion-${motion}`,
      label: `Motion: ${motion}`,
      group: 'Do',
      keywords: 'animation movement accessibility visual intensity',
      detail: 'Local visual preference; reduced-motion setting takes priority',
      flag: 'app.motion_choice',
      unavailable: context.motion === motion ? 'It’s already using that.' : undefined,
      run: () => setPrefs({ motion }),
    })),
  ];
  const drafts = context.drafts.map((draft): Command => ({
    id: `draft-${draft.id}`,
    label: `Edit draft: ${draft.name}`,
    group: 'Your drafts',
    flag: ['drafts', 'editor'],
    // the address says which one, and if it's gone by then, that page says so and changes nothing
    run: () => navigate(`/mixes/drafts/${draft.id}/edit`),
  }));
  return visible([...places, ...playback, ...actions, ...drafts]);
}

// GP-0251-06: the same folding as the Library's own search (src/selecta/library/relevance.py
// normalize_music), so "cafe" finds "Café" here too. Only for comparing: labels are shown as they are.
const UNDECOMPOSED: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ŋ: 'n' };

export function foldForSearch(text: string): string {
  const plain = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[øæœłđðþıŋ]/g, (letter) => UNDECOMPOSED[letter])
    .replace(/\p{M}+/gu, '');
  return plain
    .replace(/\b(?:featuring|feat|ft)\b/g, 'feat')
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim();
}

/** The best matches first. Each word has to appear somewhere. */
export function matchCommands(commands: Command[], query: string): Command[] {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands
    .map((command) => {
      const label = foldForSearch(command.label);
      const text = `${label} ${foldForSearch(`${command.keywords ?? ''} ${command.group}`)}`;
      if (!words.every((word) => text.includes(word))) return null;
      return { command, score: label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2 };
    })
    .filter((row): row is { command: Command; score: number } => row !== null)
    .sort((a, b) => a.score - b.score)
    .map((row) => row.command);
}
