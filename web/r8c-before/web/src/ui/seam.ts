import type { MixItem, SeamState } from '../api';
import { etaWords } from '../lib';
import type { StatusKind } from './controls';

/** The four things that are easy to mix up about a transition, kept apart: what the person chose, what
 * is being made right now, what exists, and what they'd actually hear. */
export type SeamLayers = {
  requested: string;
  inProgress: string | null;
  rendered: string | null;
  heard: string;
  /** A short name for exactly this render, or null if nothing has been made. */
  version: string | null;
  /** What exists isn't what was chosen. */
  fellBack: boolean;
};

const NOT_YET = 'Nothing yet. If it isn’t ready when the mix gets here, the song plays on and the next one fades in.';

export function seamLayers(seam: MixItem['seam'] | undefined, names: Record<string, string> = {}): SeamLayers {
  if (!seam) return { requested: 'No transition', inProgress: null, rendered: null, heard: 'Nothing, because this is the first song.', version: null, fellBack: false };
  const { settings, state } = seam;
  const chosen = settings.move && settings.move !== 'auto' ? settings.move : undefined;
  const move = chosen ? names[chosen] ?? chosen.replaceAll('_', ' ') : 'Selecta’s choice';
  const requested = [
    move,
    settings.bars ? `${settings.bars} bars` : '',
    settings.phrase ? `on “${settings.phrase}”` : '',
    settings.exit_bar !== undefined || settings.entry_bar !== undefined ? 'exact cues' : '',
  ].filter(Boolean).join(', ');
  const wait = state.eta !== undefined ? `, ${etaWords(state.eta)}` : '';
  const inProgress = state.status === 'rendering' ? `Rendering now${wait}` : state.status === 'queued' ? `Waiting in line${wait}` : null;
  if (state.status === 'failed') {
    return { requested, inProgress, rendered: 'Couldn’t be made', heard: NOT_YET, version: null, fellBack: false };
  }
  if (state.status !== 'ready') {
    return { requested, inProgress, rendered: null, heard: NOT_YET, version: null, fellBack: false };
  }
  const label = state.label ?? 'A transition';
  const fellBack = !!state.fell_back || (!!chosen && !!state.style && state.style !== chosen);
  return {
    requested,
    inProgress,
    rendered: [label, state.bars ? `${state.bars} bars` : ''].filter(Boolean).join(', '),
    heard: seam.too_soon ? `${label}, but it starts too soon, so it would be missed` : label,
    version: state.key ? state.key.slice(0, 6) : null,
    fellBack,
  };
}

export type SeamFacts = {
  kind: StatusKind;
  /** What's true of it right now, in a few words. */
  words: string;
  /** What was asked for, if what will play isn't that. */
  asked?: string;
};

/** What a transition's state means to someone listening. What was asked for and what will really
 * play are kept apart, so the page never says one and does the other. */
export function seamFacts(seam: MixItem['seam'] | undefined, names: Record<string, string> = {}): SeamFacts {
  if (!seam) return { kind: 'unavailable', words: 'No transition' };
  const state: SeamState = seam.state;
  const chosen = seam.settings.move && seam.settings.move !== 'auto' ? seam.settings.move : undefined;
  const asked = chosen ? names[chosen] ?? chosen.replaceAll('_', ' ') : undefined;
  switch (state.status) {
    case 'ready': {
      const label = state.label ?? 'Transition';
      if (seam.too_soon) return { kind: 'warning', words: `${label} would be missed`, asked };
      if (state.fell_back || (chosen && state.style && state.style !== chosen)) {
        return { kind: 'warning', words: `${label} will play, because ${asked ?? 'that move'} wouldn’t work here`, asked };
      }
      if (state.passed === false) return { kind: 'warning', words: `${label}, ready, with a warning`, asked };
      return { kind: 'ready', words: `${label}, ready`, asked };
    }
    case 'failed':
      return { kind: 'failed', words: asked ? `${asked} won’t work here` : 'This transition won’t work', asked };
    case 'rendering':
      return { kind: 'working', words: state.eta !== undefined ? `Rendering, ${etaWords(state.eta)}` : 'Rendering', asked };
    case 'queued':
      return { kind: 'queued', words: state.eta !== undefined ? `In line, ${etaWords(state.eta)}` : 'In line', asked };
    default:
      return { kind: 'planned', words: state.eta !== undefined ? `Not rendered yet, about ${etaWords(state.eta).replace(/^about /, '')}` : 'Not rendered yet', asked };
  }
}
