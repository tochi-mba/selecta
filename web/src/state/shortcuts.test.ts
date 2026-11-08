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
