import { describe, expect, it } from 'vitest';
import { shortcutFor } from './shortcuts';

// SF-0244-03: no shortcut ever takes a key press from someone typing. Every single-key and chord
// shortcut is tried in each kind of text editor; each one still works from the page itself.
const KEYS = [
  { key: ' ', code: 'Space' },
  { key: 'n', code: 'KeyN' },
  { key: 'N', code: 'KeyN', shiftKey: true },
  { key: 'p', code: 'KeyP' },
  { key: 'm', code: 'KeyM' },
  { key: 'r', code: 'KeyR' },
  { key: 'z', code: 'KeyZ' },
  { key: 'f', code: 'KeyF' },
  { key: '?', code: 'Slash', shiftKey: true },
  { key: '/', code: 'Slash' },
  { key: 'ArrowLeft', code: 'ArrowLeft' },
  { key: 'ArrowRight', code: 'ArrowRight' },
  { key: 'k', code: 'KeyK', ctrlKey: true },
  { key: 'k', code: 'KeyK', metaKey: true },
];

function press(target: EventTarget, k: (typeof KEYS)[number]) {
  return shortcutFor({
    key: k.key, code: k.code, target,
    ctrlKey: !!k.ctrlKey, metaKey: !!k.metaKey, shiftKey: !!k.shiftKey, altKey: false,
  });
}

function editors(): HTMLElement[] {
  const text = document.createElement('input');
  const search = document.createElement('input');
  search.type = 'search';
  const number = document.createElement('input');
  number.type = 'number';
  const area = document.createElement('textarea');
  const select = document.createElement('select');
  const rich = document.createElement('div');
  rich.contentEditable = 'true';
  // jsdom has no isContentEditable getter; model the browser's
  Object.defineProperty(rich, 'isContentEditable', { value: true });
  const inside = document.createElement('span');
  Object.defineProperty(inside, 'isContentEditable', { value: true });
  rich.append(inside);
  return [text, search, number, area, select, rich, inside];
}

describe('SF-0244-03 typing is never interrupted by a shortcut', () => {
  it('every shortcut key does nothing while a text field, text area, list or rich editor has focus', () => {
    for (const editor of editors()) {
      for (const k of KEYS) {
        expect(press(editor, k), `${k.key} in ${editor.tagName}`).toBeNull();
      }
    }
  });

  it('the same keys still work from the page, so the guard is what stops them', () => {
    for (const k of KEYS) expect(press(document.body, k), k.key).not.toBeNull();
  });
});
