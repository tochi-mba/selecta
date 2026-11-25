import { describe, expect, it } from 'vitest';
import { CLOSE_AFTER, dragToClose, FLICK, sheetCloses, sheetOffset } from './sheetDrag';

describe('phone sheet drag (ADR-0477)', () => {
  it('follows a finger down and gives only a little up', () => {
    expect(sheetOffset(0)).toBe(0);
    expect(sheetOffset(40)).toBe(40);
    expect(sheetOffset(-4)).toBeCloseTo(-4);
    expect(sheetOffset(-400)).toBe(-24);
  });

  it('closes after a long drag or a flick, never on a drag up', () => {
    expect(sheetCloses(CLOSE_AFTER + 1, 0)).toBe(true);
    expect(sheetCloses(20, FLICK + 0.1)).toBe(true);
    expect(sheetCloses(20, FLICK - 0.1)).toBe(false);
    expect(sheetCloses(10, 5)).toBe(false);
    expect(sheetCloses(-200, -5)).toBe(false);
  });

  it('does nothing with the feel off: a press on the title bar never closes the sheet', () => {
    const panel = document.createElement('div');
    const head = document.createElement('header');
    head.className = 'overlay-head';
    panel.append(head);
    document.body.append(panel);
    let closed = false;
    const stop = dragToClose(panel, () => { closed = true; });
    // jsdom may have no PointerEvent, so a plain event carries the fields the drag reads
    const at = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { isPrimary: true, pointerId: 1, clientY: y, button: 0, pointerType: 'touch' });
      head.dispatchEvent(event);
    };
    at('pointerdown', 0);
    at('pointermove', 300);
    at('pointerup', 300);
    expect(closed).toBe(false);
    expect(panel.style.translate).toBe('');
    stop();
    panel.remove();
  });
});
