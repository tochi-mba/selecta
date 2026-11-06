import type { MixItem, SeamState } from '../api';
import { etaWords } from '../lib';
import type { StatusKind } from './controls';

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
