import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { startPointerLight } from './pointerLight';
import { resetFeel, startFeel } from './root';

/** FL-0477-06: one document listener lights the nearest `[data-glow]` under a mouse, writing only on
 * that element, and stays off for touch, for a computer that cannot hover and with the part off. */

let pending: FrameRequestCallback | null = null;
let precise = true;
const stops: (() => void)[] = [];

function frame() {
  const run = pending;
  pending = null;
  run?.(0);
}

function pointer(type: string, target: Element, x: number, y: number, pointerType = 'mouse', relatedTarget: EventTarget | null = null) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, relatedTarget });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

function glow(left: number, top: number, parent: Element = document.body): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-glow', '');
  element.getBoundingClientRect = () => ({ left, top, width: 200, height: 100, right: left + 200, bottom: top + 100, x: left, y: top, toJSON: () => null }) as DOMRect;
  parent.append(element);
  return element;
}

const at = (element: HTMLElement) => [element.style.getPropertyValue('--mx'), element.style.getPropertyValue('--my')];

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  setPrefs({ motion: 'expressive' });
  resetFeel();
  precise = true;
  pending = null;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { pending = null; }));
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: precise && query.includes('pointer: fine'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  stops.push(startFeel());
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  resetFeel();
  document.body.replaceChildren();
});

describe('FL-0477-06 the pointer light', () => {
  it('writes --mx and --my on the nearest glowing element only', () => {
    stops.push(startPointerLight());
    const outer = glow(0, 0);
    const inner = glow(100, 50, outer);
    const label = document.createElement('span');
    inner.append(label);
    const rootWrites = vi.spyOn(document.documentElement.style, 'setProperty');
    pointer('pointermove', label, 130, 70);
    frame();
    expect(at(inner)).toEqual(['30px', '20px']);
    expect(at(outer)).toEqual(['', '']);
    expect(rootWrites).not.toHaveBeenCalled();
  });

  it('folds many moves into one frame, using the last', () => {
    stops.push(startPointerLight());
    const card = glow(0, 0);
    pointer('pointermove', card, 10, 10);
    pointer('pointermove', card, 40, 30);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    frame();
    expect(at(card)).toEqual(['40px', '30px']);
  });

  it('clears the light on leaving, and moves it from one card to the next', () => {
    stops.push(startPointerLight());
    const first = glow(0, 0);
    const second = glow(300, 0);
    pointer('pointermove', first, 20, 20);
    frame();
    pointer('pointermove', second, 320, 20);
    frame();
    expect(at(first)).toEqual(['', '']);
    expect(at(second)).toEqual(['20px', '20px']);
    pointer('pointerout', second, 320, 20, 'mouse', document.body);
    expect(at(second)).toEqual(['', '']);
  });

  it('gives a finger no light', () => {
    stops.push(startPointerLight());
    const card = glow(0, 0);
    pointer('pointermove', card, 20, 20, 'touch');
    frame();
    expect(at(card)).toEqual(['', '']);
  });

  it('stays off on a computer that cannot hover', () => {
    precise = false;
    stops.push(startPointerLight());
    const card = glow(0, 0);
    pointer('pointermove', card, 20, 20);
    frame();
    expect(at(card)).toEqual(['', '']);
  });

  it('stays off with the part off, and puts out a lit card when the part goes', () => {
    setPrefs({ motion: 'subtle' });
    stops.push(startPointerLight());
    const card = glow(0, 0);
    pointer('pointermove', card, 20, 20);
    frame();
    expect(at(card)).toEqual(['', '']);

    setPrefs({ motion: 'expressive' });
    pointer('pointermove', card, 20, 20);
    frame();
    expect(at(card)).toEqual(['20px', '20px']);
    setPrefs({ motion: 'subtle' });
    expect(at(card)).toEqual(['', '']);
  });

  it('stops listening when the last start is stopped', () => {
    const one = startPointerLight();
    const two = startPointerLight();
    const card = glow(0, 0);
    one();
    pointer('pointermove', card, 20, 20);
    frame();
    expect(at(card)).toEqual(['20px', '20px']);
    two();
    expect(at(card)).toEqual(['', '']);
    pointer('pointermove', card, 50, 50);
    frame();
    expect(at(card)).toEqual(['', '']);
  });
});
