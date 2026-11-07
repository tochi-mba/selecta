/** Every keyboard shortcut, in one list that the handler and the help screen both read, so the help can
 * only ever say what's true.
 *
 * Who gets a key, highest first:
 *   1. an open dialog, sheet or menu
 *   2. whatever has focus and needs that key: a text box, slider, grid, menu, tab list
 *   3. the page's own keys, handled by the page
 *   4. the keys below
 *
 * The exceptions are spelled out in docs/adr/selecta-3-keyboard.md. */

export type ShortcutId =
  | 'palette' | 'playPause' | 'jump' | 'next' | 'previous' | 'back5' | 'forward5'
  | 'mute' | 'request' | 'undo' | 'stage' | 'search' | 'help';

export type Shortcut = { id: ShortcutId; keys: string; label: string; group: 'Playback' | 'Go to' | 'Editing' | 'Help' };

export const SHORTCUTS: Shortcut[] = [
  { id: 'playPause', keys: 'Space', label: 'Play or pause', group: 'Playback' },
  { id: 'jump', keys: 'N', label: 'Jump to the transition', group: 'Playback' },
  { id: 'next', keys: 'Shift N', label: 'Next song', group: 'Playback' },
  { id: 'previous', keys: 'P', label: 'Previous song', group: 'Playback' },
  { id: 'back5', keys: '←', label: 'Back 5 seconds', group: 'Playback' },
  { id: 'forward5', keys: '→', label: 'Forward 5 seconds', group: 'Playback' },
  { id: 'mute', keys: 'M', label: 'Mute', group: 'Playback' },
  { id: 'stage', keys: 'F', label: 'Fullscreen lyrics', group: 'Playback' },
  { id: 'request', keys: 'R', label: 'Request a song', group: 'Go to' },
  { id: 'search', keys: '/', label: 'Search your library', group: 'Go to' },
  { id: 'palette', keys: 'Ctrl K', label: 'Search and commands', group: 'Go to' },
  { id: 'undo', keys: 'Z', label: 'Undo', group: 'Editing' },
  { id: 'help', keys: '?', label: 'This list', group: 'Help' },
];

const OWNS_ITS_KEYS = '[role="grid"],[role="menu"],[role="dialog"],[role="tablist"],[role="slider"],[role="listbox"],[role="combobox"],[role="radiogroup"]';
const ACTIVATES_WITH_SPACE = 'button,a[href],summary,[role="button"],[role="checkbox"],[role="menuitem"],[role="menuitemcheckbox"],[role="option"],[role="radio"],[role="switch"],[role="tab"]';

/** Does whatever has focus need this key for itself? */
export function focusOwnsKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return /INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable || !!target.closest(OWNS_ITS_KEYS);
}

export function anOverlayIsOpen(): boolean {
  return !!document.querySelector('.overlay');
}

/** Which shortcut this key press means here, if any. */
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'code' | 'target' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): ShortcutId | null {
  const key = event.key.toLowerCase();
  // the one shortcut that works from a text box, because nothing being typed uses it
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'k') return anOverlayIsOpen() ? null : 'palette';
  if (focusOwnsKeys(event.target) || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.code === 'Space') {
    return event.target instanceof HTMLElement && !!event.target.closest(ACTIVATES_WITH_SPACE) ? null : 'playPause';
  }
  if (key === 'n') return event.shiftKey ? 'next' : 'jump';
  if (key === 'p') return 'previous';
  if (key === 'm') return 'mute';
  if (key === 'r') return 'request';
  if (key === 'z') return 'undo';
  if (key === 'f') return 'stage';
  if (key === '?') return 'help';
  if (event.key === '/') return 'search';
  if (event.key === 'ArrowLeft') return 'back5';
  if (event.key === 'ArrowRight') return 'forward5';
  return null;
}
