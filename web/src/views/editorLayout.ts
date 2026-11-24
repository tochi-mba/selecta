import { useEffect, useState } from 'react';
import { useFlag } from '../flags';
import { above, below } from '../styles/breakpoints';

/** How the editor is laid out for the window it is in (editor.phone_layout):
 *  - `sheet`: one column; an opened song or transition rises from the bottom (a phone, up to 640px)
 *  - `panes`: the list and the opened song or transition side by side (wider than 640px, or a phone
 *    on its side, under 500px tall)
 *  - `classic`: the editor as it was (the flag is off, or a wide window with the transition inspector,
 *    whose Arrange, Story and Detail views already fit it)
 * Decided by the window's size alone, never by which device it is (window size classes). */
export type EditorLayout = 'sheet' | 'panes' | 'classic';

export const COMPACT = `${below('phone')} and (min-height: 500px)`;
export const SHORT = '(max-height: 499px)';
/** where the classic editor already puts its inspector beside the timeline */
export const WIDE = above('laptop');
export const NARROWER = below('laptop');

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

export function layoutFor(inspector: boolean): EditorLayout {
  // Each layout needs its own query to say yes, so no answer at all (a test page, an old browser, a
  // stub that answers no to everything) keeps the editor as it was.
  if (matches(COMPACT)) return 'sheet';
  if (matches(SHORT) || matches(NARROWER)) return 'panes';
  if (matches(WIDE) && !inspector) return 'panes';
  return 'classic';
}

export function useEditorLayout(): EditorLayout {
  const on = useFlag('editor.phone_layout');
  const inspector = useFlag('seam_inspector');
  const [layout, setLayout] = useState<EditorLayout>(() => (on ? layoutFor(inspector) : 'classic'));
  useEffect(() => {
    if (!on) {
      setLayout('classic');
      return undefined;
    }
    const update = () => setLayout(layoutFor(inspector));
    update();
    if (typeof window.matchMedia !== 'function') return undefined;
    const lists = [COMPACT, SHORT, NARROWER, WIDE].map((query) => window.matchMedia(query));
    for (const list of lists) list.addEventListener?.('change', update);
    return () => { for (const list of lists) list.removeEventListener?.('change', update); };
  }, [on, inspector]);
  return layout;
}
