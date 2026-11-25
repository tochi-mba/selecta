import { feelOn } from '../feel/root';

/** Keycaps that light while their key is held (ADR-0477, plan 3.2 "Help and activity"): in the
 * keyboard shortcuts list, or any other open dialog, a `<kbd>` naming the key being pressed takes
 * `data-held` until the key is let go, so trying a shortcut shows which one it was. The command
 * palette's hint keeps its own (ui/CommandPalette.tsx) and is skipped here.
 *
 * One pair of listeners on the document for the whole app. They only look inside open overlays,
 * only when a key goes down or up, and only with the feel's motion on, so typing on a page costs a
 * single check of the flag. Decoration: the shortcut works the same either way. */

const SKIPPED = '.palette-keys kbd';

/** The words a keycap may use for a key, lower case. */
export function keyNames(key: string): string[] {
  const name = key.toLowerCase();
  const aliases: Record<string, string[]> = {
    ' ': ['space', 'spacebar'],
    control: ['ctrl', 'control'],
    meta: ['cmd', 'command', 'meta', 'win'],
    alt: ['alt', 'option'],
    escape: ['esc', 'escape'],
    enter: ['enter', 'return'],
    arrowleft: ['left', '←', 'arrow keys', 'arrows'],
    arrowright: ['right', '→', 'arrow keys', 'arrows'],
    arrowup: ['up', '↑', 'arrow keys', 'arrows'],
    arrowdown: ['down', '↓', 'arrow keys', 'arrows'],
  };
  return aliases[name] ?? [name];
}

/** Whether a keycap's words name any key in `held`: "Ctrl K" lights for Ctrl and for K, "?" for ?,
 * "Arrow keys" for any arrow. */
export function capNames(cap: string, held: ReadonlySet<string>): boolean {
  const words = cap.trim().toLowerCase();
  if (!words) return false;
  const parts = new Set([words, ...words.split(/[\s+]+/).filter(Boolean)]);
  for (const key of held) if (keyNames(key).some((name) => parts.has(name))) return true;
  return false;
}

let stop: (() => void) | null = null;

/** Start lighting keycaps. Safe to call more than once; the first stop ends it. */
export function startKeycaps(): () => void {
  if (typeof document === 'undefined' || stop) return stop ?? (() => {});
  const held = new Set<string>();
  const paint = () => {
    for (const cap of document.querySelectorAll<HTMLElement>('.overlay kbd, .overlay-panel kbd')) {
      if (cap.matches(SKIPPED)) continue;
      cap.toggleAttribute('data-held', held.size > 0 && capNames(cap.textContent ?? '', held));
    }
  };
  const down = (event: KeyboardEvent) => {
    if (!feelOn('motion') || event.repeat) return;
    held.add(event.key);
    paint();
  };
  const up = (event: KeyboardEvent) => {
    if (!held.size) return;
    held.delete(event.key);
    // Shift changes the key's name between down and up ("?" goes down, "/" comes up), so once no
    // modifier is held nothing can still be down that this listener should keep lit
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) held.clear();
    paint();
  };
  // a key let go in another window never sends its keyup here
  const away = () => {
    if (!held.size) return;
    held.clear();
    paint();
  };
  document.addEventListener('keydown', down, true);
  document.addEventListener('keyup', up, true);
  window.addEventListener('blur', away);
  const ended = () => {
    document.removeEventListener('keydown', down, true);
    document.removeEventListener('keyup', up, true);
    window.removeEventListener('blur', away);
    stop = null;
  };
  stop = ended;
  return ended;
}
