import { ReactNode, useRef, useSyncExternalStore } from 'react';
import { feelOn, feelParts, onFeelChange } from '../feel/root';
import { INDICATOR_CLASS, useSlidingIndicator } from '../feel/indicator';
import { Icon } from '../ui/Icon';
import { BlendArt } from './BlendArt';

// The feel system on the legacy Cloud frame (ADR-0477, plan 3.13). Kept out of CloudApp.tsx, which
// is near its size limit. With every app.feel_* flag off these draw exactly the markup the frame
// always had (CloudApp.test.tsx pins the rail's HTML), so the extra parts appear only while on.

/** The rail's page list. With the feel's motion on, a block slides behind the current page when
 * another is chosen; the current page is still carried by aria-current and its own style. */
export function RailNav({ children }: { children: ReactNode }) {
  const list = useRef<HTMLElement>(null);
  const moving = useSyncExternalStore(onFeelChange, () => feelOn('motion'), () => false);
  useSlidingIndicator(list, '[aria-current="page"]');
  return (
    <nav aria-label="Cloud workspace" ref={list} data-indicator-shape={moving ? 'fill' : undefined}>
      {/* first, so the moving block is painted under the page names, not over them */}
      {moving && <span className={INDICATOR_CLASS} aria-hidden="true" />}
      {children}
    </nav>
  );
}

/** Whether any part of the feel is on: the hosted pages draw covers and other new parts only then,
 * so with every app.feel_* flag off they are exactly as they were. */
export function useFeelAlive(): boolean {
  return useSyncExternalStore(onFeelChange, () => feelParts().length > 0, () => false);
}

/** The Overview hero's drawing: two songs blending (BlendArt) once any part of the feel is on, in
 * place of the static circles, which stay exactly as they were with the feel off. */
export function OverviewHeroArt() {
  const alive = useFeelAlive();
  if (alive) return <div className="cloud-hero-blend"><BlendArt /></div>;
  return <div className="cloud-hero-art" aria-hidden="true"><Icon name="music" size="hero" /><i /><b /><em /></div>;
}
