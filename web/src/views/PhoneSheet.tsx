import { ReactNode, useEffect, useRef, useState } from 'react';
import { Sheet } from '../ui/controls';

export type Detent = 'half' | 'full' | 'fit';

/** How far a finger has to travel, in CSS pixels, before letting go changes the sheet's height. */
const SNAP = 64;
/** A flick: this fast (px per ms) changes the height even over a short distance. */
const FLICK = 0.5;

/** The editor's bottom sheet (editor.phone_layout). It is the app's own sheet, so focus moves into it,
 * stays in it and goes back to whatever opened it, and Escape closes it. On top of that it has:
 *  - a grabber, which is a real button: tapping it, or pressing it with a screen reader, switches
 *    between half and full height
 *  - a drag on the grabber or the title bar: up to grow, down to shrink, and down from half to close.
 *    A drag that starts in the sheet's content only scrolls the content.
 *  - the Back button, which closes it rather than leaving the editor.
 * `size`: `resizable` (a transition) opens at half and snaps to half or full; `tall` (adding songs)
 * is full height; `fit` (a song's or the mix's actions) is as tall as what it holds. Only `resizable`
 * changes height; the others close on a drag down or a press on the grabber. */
export function PhoneSheet(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'resizable' | 'tall' | 'fit';
}) {
  const { title, onClose, children, footer, size = 'resizable' } = props;
  const tall = size !== 'resizable';
  const [detent, setDetent] = useState<Detent>(size === 'tall' ? 'full' : size === 'fit' ? 'fit' : 'half');
  const zone = useRef<HTMLDivElement>(null);
  const now = useRef({ detent, tall, onClose });
  now.current = { detent, tall, onClose };
  const swallowClick = useRef(false);

  // Back closes the sheet: a history entry of its own while it is open, taken back when it closes
  // any other way. If the page has moved on to another address meanwhile, that entry is left alone.
  useEffect(() => {
    const token = `sheet-${Math.random().toString(36).slice(2)}`;
    const ours = () => (window.history.state as { editorSheet?: string } | null)?.editorSheet === token;
    try { window.history.pushState({ ...(window.history.state ?? {}), editorSheet: token }, ''); } catch { return undefined; }
    let closedByBack = false;
    const back = () => {
      if (ours()) return;
      closedByBack = true;
      now.current.onClose();
    };
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('popstate', back);
      if (!closedByBack && ours()) window.history.back();
    };
  }, []);

  // Dragging the grabber or the title bar. Native listeners, because the app's sheet draws the title
  // bar itself; only the first finger counts, and the Close button stays a button.
  useEffect(() => {
    const grabZone = zone.current;
    const panel = grabZone?.closest<HTMLElement>('.overlay-panel');
    const head = panel?.querySelector<HTMLElement>('.overlay-head');
    if (!grabZone || !panel) return undefined;
    let held: { id: number; y: number; at: number; moved: number; on: HTMLElement } | null = null;
    const place = (offset: number) => {
      const floor = now.current.detent === 'half' ? -48 : 0;
      panel.style.transform = offset ? `translateY(${Math.max(offset, floor)}px)` : '';
    };
    const start = (event: PointerEvent) => {
      if (held || !event.isPrimary || (event.target as HTMLElement).closest('.overlay-close')) return;
      const on = event.currentTarget as HTMLElement;
      held = { id: event.pointerId, y: event.clientY, at: event.timeStamp, moved: 0, on };
      on.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!held || held.id !== event.pointerId) return;
      held.moved = event.clientY - held.y;
      if (Math.abs(held.moved) > 4) panel.setAttribute('data-dragging', 'true');
      place(held.moved);
    };
    const stop = () => {
      held = null;
      panel.removeAttribute('data-dragging');
      place(0);
    };
    const end = (event: PointerEvent) => {
      if (!held || held.id !== event.pointerId) return;
      const { moved, at } = held;
      stop();
      if (Math.abs(moved) < 6) return;
      // the click that follows a real drag must not also toggle the height
      swallowClick.current = true;
      window.setTimeout(() => { swallowClick.current = false; }, 400);
      const speed = moved / Math.max(1, event.timeStamp - at);
      const { detent: was, tall: isTall, onClose: close } = now.current;
      if (moved > SNAP || (moved > 16 && speed > FLICK)) {
        if (was === 'full' && !isTall) setDetent('half');
        else close();
      } else if ((moved < -SNAP || (moved < -16 && speed < -FLICK)) && was === 'half') {
        setDetent('full');
      }
    };
    const targets = [grabZone, head].filter((node): node is HTMLElement => !!node);
    for (const node of targets) {
      node.addEventListener('pointerdown', start);
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', stop);
    }
    return () => {
      for (const node of targets) {
        node.removeEventListener('pointerdown', start);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', end);
        node.removeEventListener('pointercancel', stop);
      }
    };
  }, []);

  const grabber = (
    <div className="pe-grab-zone" ref={zone}>
      <button
        type="button"
        className="pe-grabber"
        aria-label={tall ? `Close ${title}` : detent === 'half' ? 'Make the sheet taller' : 'Make the sheet shorter'}
        onClick={() => {
          if (swallowClick.current) return;
          if (tall) onClose();
          else setDetent((was) => (was === 'half' ? 'full' : 'half'));
        }}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <Sheet title={title} onClose={onClose} footer={footer} keepsChrome className={`pe-sheet is-${detent}`} grabber={grabber}>
      {children}
    </Sheet>
  );
}
