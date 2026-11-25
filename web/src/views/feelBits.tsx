// Small feel pieces shared by Make a Mix and Listen (ADR-0477): a hook that says whether one part of
// the feel is on, the decorative beat targets the beat bus pulses, and Play's icon that morphs into
// Pause. Each is decoration only and draws nothing that matters while its part is off.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { registerBeatTarget, type BeatKind } from '../feel/beatBus';
import { feelOn, onFeelChange, type FeelPart } from '../feel/root';
import { Icon } from '../ui/Icon';

/** Whether one part of the feel is on, kept current as flags, the motion choice or low power change. */
export function useFeelPart(part: FeelPart): boolean {
  return useSyncExternalStore(onFeelChange, () => feelOn(part), () => false);
}

/** A decorative child the beat bus pulses on measured kicks (feel-music.css draws its resting shape
 * and hides it while the music part is off). Registered for as long as it is on the page. */
export function BeatSpot({ kind }: { kind: Exclude<BeatKind, 'bars'> }) {
  const spot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = spot.current;
    return element ? registerBeatTarget(element, kind) : undefined;
  }, [kind]);
  return <span ref={spot} data-beat={kind} aria-hidden="true" />;
}

/** Three bars the bus lifts from the measured bands while this is the music playing. */
export function PlayingBars() {
  const bars = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = bars.current;
    return element ? registerBeatTarget(element, 'bars') : undefined;
  }, []);
  return <span ref={bars} data-playing-bars="" aria-hidden="true"><i /><i /><i /></span>;
}

/** Play and Pause drawn on top of each other, the shown one at full size and the other folded away,
 * so a press turns one into the other. Only drawn with the motion part on, so the button is exactly
 * as it was otherwise; its words stay its name. */
export function PlayMorph({ playing }: { playing: boolean }) {
  const moving = useFeelPart('motion');
  if (!moving) return null;
  return (
    <span className="play-morph" data-state={playing ? 'pause' : 'play'} aria-hidden="true">
      <Icon name="play" className="play-morph-play" />
      <Icon name="pause" className="play-morph-pause" />
    </span>
  );
}

/** A spring curve and a length from the tokens, for a script animation (which cannot read a token). */
export function springOf(token: '--spring-snappy' | '--spring-gentle' | '--spring-bouncy' = '--spring-snappy'): string {
  if (typeof document === 'undefined') return 'ease-out';
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || 'ease-out';
}

/** A space token in pixels, for a script animation's travel. */
export function spaceOf(token: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || fallback;
}
