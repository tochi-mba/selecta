import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { flip, FLIP_LIMIT } from './flip';

/** FL-0477-06: a reorder glides on transform only, on at most 40 elements on screen, and simply
 * happens when the feel is calm or the motion flag is off. */

type Box = { left: number; top: number; width: number; height: number };
const boxes = new Map<Element, Box>();
let played: { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];

function row(box: Box): HTMLElement {
  const element = document.createElement('li');
  document.body.append(element);
  boxes.set(element, box);
  return element;
}

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  boxes.clear();
  played = [];
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const box = boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
  });
  Element.prototype.animate = function animate(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
    played.push({ element: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions });
    return { cancel: vi.fn(), onfinish: null } as unknown as Animation;
  };
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).animate;
  document.body.replaceChildren();
});

describe('FL-0477-06 flip', () => {
  it('glides moved elements from where they were, on transform alone', async () => {
    const a = row({ left: 0, top: 0, width: 100, height: 20 });
    const b = row({ left: 0, top: 20, width: 100, height: 20 });
    const mutate = vi.fn(() => {
      boxes.set(a, { left: 0, top: 20, width: 100, height: 20 });
      boxes.set(b, { left: 0, top: 0, width: 100, height: 20 });
    });
    await flip([a, b], mutate);
    expect(mutate).toHaveBeenCalledOnce();
    expect(played).toHaveLength(2);
    const first = played.find((entry) => entry.element === a)!;
    expect(first.keyframes[0].transform).toBe('translate(0.0px, -20.0px) scale(1.000, 1.000)');
    expect(first.keyframes[1].transform).toBe('translate(0, 0) scale(1, 1)');
    for (const entry of played) {
      for (const keyframe of entry.keyframes) expect(Object.keys(keyframe)).toEqual(['transform']);
      expect(entry.options.composite).toBe('add');
      expect(entry.options.duration).toBeGreaterThan(0);
    }
  });

  it('touches at most 40 elements', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => row({ left: 0, top: index * 10, width: 100, height: 10 }));
    await flip(rows, () => {
      rows.forEach((element, index) => boxes.set(element, { left: 0, top: index * 10 + 5, width: 100, height: 10 }));
    });
    expect(FLIP_LIMIT).toBe(40);
    expect(played).toHaveLength(40);
  });

  it('skips what did not move, what was off screen and what left the page', async () => {
    const still = row({ left: 0, top: 0, width: 100, height: 20 });
    const off = row({ left: 0, top: 5000, width: 100, height: 20 });
    const gone = row({ left: 0, top: 40, width: 100, height: 20 });
    await flip([still, off, gone], () => {
      boxes.set(off, { left: 0, top: 0, width: 100, height: 20 });
      gone.remove();
    });
    expect(played).toHaveLength(0);
  });

  it('simply makes the change under Still, reduced motion, or with the motion flag off', async () => {
    for (const calm of [
      () => setPrefs({ motion: 'still' }),
      () => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))),
      () => setFlags({ 'app.feel_motion': false }),
      () => { document.documentElement.dataset.lowPower = 'auto'; },
    ]) {
      delete document.documentElement.dataset.lowPower;
      setPrefs({ motion: 'expressive' });
      setFlags({});
      vi.unstubAllGlobals();
      calm();
      const a = row({ left: 0, top: 0, width: 100, height: 20 });
      const mutate = vi.fn(() => { boxes.set(a, { left: 0, top: 60, width: 100, height: 20 }); });
      await flip([a], mutate);
      expect(mutate).toHaveBeenCalledOnce();
      expect(played).toHaveLength(0);
    }
    delete document.documentElement.dataset.lowPower;
  });

  it('a second flip stops the first one where it got to and starts from there', async () => {
    const cancels: ReturnType<typeof vi.fn>[] = [];
    Element.prototype.animate = function animate(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
      played.push({ element: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions });
      const cancel = vi.fn();
      cancels.push(cancel);
      return { cancel, onfinish: null } as unknown as Animation;
    };
    const a = row({ left: 0, top: 0, width: 100, height: 20 });
    await flip([a], () => { boxes.set(a, { left: 0, top: 40, width: 100, height: 20 }); });
    expect(played).toHaveLength(1);
    // part way: the element is measured at 25, the first move is cancelled, the next starts there
    boxes.set(a, { left: 0, top: 25, width: 100, height: 20 });
    await flip([a], () => { boxes.set(a, { left: 0, top: 0, width: 100, height: 20 }); });
    expect(cancels[0]).toHaveBeenCalledOnce();
    expect(played).toHaveLength(2);
    expect(played[1].keyframes[0].transform).toBe('translate(0.0px, 25.0px) scale(1.000, 1.000)');
  });

  it('waits for an asynchronous change before measuring again', async () => {
    const a = row({ left: 0, top: 0, width: 100, height: 20 });
    await flip([a], async () => {
      await Promise.resolve();
      boxes.set(a, { left: 0, top: 30, width: 100, height: 20 });
    });
    expect(played).toHaveLength(1);
  });
});
