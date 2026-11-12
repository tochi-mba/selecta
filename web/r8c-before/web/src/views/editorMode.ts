import { useCallback } from 'react';
import type { MixItem } from '../api';
import { setQuery, useQueryParam } from '../router';
import type { StatusKind } from '../ui/controls';
import { seamFacts, seamLayers } from '../ui/seam';

/** Three ways of looking at the same mix. They are views only: switching never changes the mix, what's
 * playing, which mix is being edited or what is selected. */
export type EditorMode = 'story' | 'arrange' | 'detail';

export const EDITOR_MODES: { id: EditorMode; label: string; about: string }[] = [
  { id: 'story', label: 'Story', about: 'Songs in order and how each one leads into the next. Nothing here changes the mix.' },
  { id: 'arrange', label: 'Arrange', about: 'Reorder, add and remove songs. Select a transition to hear or change it.' },
  { id: 'detail', label: 'Detail', about: 'The timeline with a transition open, for exact cues, bars and moves.' },
];

/** Arrange is what the editor has always been, so it has no address of its own. Anything unrecognised
 * is Arrange too, rather than a page that guesses. */
export function parseEditorMode(raw: string | null): EditorMode {
  return raw === 'story' || raw === 'detail' ? raw : 'arrange';
}

/** The view lives in the address (`?view=story`), so reloading or sharing a link keeps it. It replaces
 * the address rather than adding to the history, so Back still leaves the editor. */
export function useEditorMode(): [EditorMode, (next: EditorMode) => void] {
  const mode = parseEditorMode(useQueryParam('view'));
  const choose = useCallback((next: EditorMode) => setQuery({ view: next === 'arrange' ? null : next }), []);
  return [mode, choose];
}

/** What's selected, by the same keys the timeline uses: a song by which time it appears, and a
 * transition by the two songs it's between. */
export type EditorSelection = { kind: 'song'; key: string } | { kind: 'seam'; a: string; b: string };

export type StorySeamWords = { kind: StatusKind; headline: string; detail: string | null };

/** A transition in plain words, from what the server says about it and nothing else. What was asked for
 * and what will really play are kept apart, as everywhere else. */
export function storySeamWords(seam: MixItem['seam'] | undefined, names: Record<string, string>, from: string): StorySeamWords {
  if (!seam) return { kind: 'unavailable', headline: 'No transition', detail: null };
  const layers = seamLayers(seam, names);
  const facts = seamFacts(seam, names);
  const state = seam.state;
  const early = seam.too_soon ? `It leaves ${from} too early, so it would be missed.` : null;
  const planned = `Planned: ${layers.requested}.`;
  switch (state.status) {
    case 'ready': {
      const label = state.label ?? 'a transition';
      if (seam.too_soon) return { kind: 'warning', headline: layers.heard, detail: null };
      if (layers.fellBack) {
        return { kind: 'warning', headline: `Fell back to ${label}`, detail: facts.asked ? `You chose ${facts.asked}, which wouldn’t work here.` : null };
      }
      return { kind: facts.kind, headline: layers.rendered ?? label, detail: state.passed === false ? 'Ready, with a warning.' : null };
    }
    case 'failed':
      return { kind: 'failed', headline: 'Couldn’t be made', detail: [facts.asked ? `You chose ${facts.asked}.` : '', layers.heard].filter(Boolean).join(' ') };
    case 'rendering':
      return { kind: 'working', headline: layers.inProgress ?? 'Rendering now', detail: [planned, early].filter(Boolean).join(' ') };
    case 'queued':
      return { kind: 'queued', headline: layers.inProgress ?? 'Waiting in line', detail: [planned, early].filter(Boolean).join(' ') };
    default:
      return { kind: 'planned', headline: 'Not rendered yet', detail: [planned, early].filter(Boolean).join(' ') };
  }
}
