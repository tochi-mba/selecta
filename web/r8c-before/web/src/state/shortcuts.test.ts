import { describe, expect, it } from 'vitest';
import { shortcutFor } from './shortcuts';

function ctrlK(target: EventTarget, metaKey = false) {
  return shortcutFor({
    key: 'k', code: 'KeyK', target,
    ctrlKey: !metaKey, metaKey, shiftKey: false, altKey: false,
  });
}

describe('palette shortcut focus ownership', () => {
  it('does not take Ctrl K or Cmd K from text editing', () => {
    for (const tag of ['input', 'textarea'] as const) {
      const target = document.createElement(tag);
      expect(ctrlK(target)).toBeNull();
      expect(ctrlK(target, true)).toBeNull();
    }
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    // jsdom does not implement HTMLElement.isContentEditable; model the real browser getter.
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    expect(ctrlK(editor)).toBeNull();
    const list = document.createElement('div');
    list.setAttribute('role', 'combobox');
    expect(ctrlK(list)).toBeNull();
  });

  it('opens from the page, but not while an overlay owns the keys', () => {
    expect(ctrlK(document.body)).toBe('palette');
    const dialog = document.createElement('div');
    dialog.className = 'overlay';
    document.body.append(dialog);
    try {
      expect(ctrlK(document.body)).toBeNull();
    } finally {
      dialog.remove();
    }
  });
});

function space(target: EventTarget) {
  return shortcutFor({ key: ' ', code: 'Space', target, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
}

// S4-0110-02: Space belongs to the focused control, not to global playback.
describe('Space ownership', () => {
  it('leaves Space to a custom role=button reorder grip and its children', () => {
    const grip = document.createElement('span');
    grip.setAttribute('role', 'button');
    grip.tabIndex = 0;
    const glyph = document.createElement('svg');
    grip.append(glyph);
    document.body.append(grip);
    try {
      expect(space(grip)).toBeNull();
      expect(space(glyph)).toBeNull();
    } finally {
      grip.remove();
    }
  });

  it('leaves Space to real buttons, checkboxes, text and grids', () => {
    const button = document.createElement('button');
    const box = document.createElement('input');
    box.type = 'checkbox';
    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    const cell = document.createElement('span');
    grid.append(cell);
    for (const target of [button, box, document.createElement('textarea'), cell]) expect(space(target)).toBeNull();
  });

  it('still plays or pauses when nothing focused needs the key', () => {
    expect(space(document.body)).toBe('playPause');
  });
});
