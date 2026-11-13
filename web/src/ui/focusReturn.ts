/** Where focus goes back to when an overlay closes (EX-0131-02).
 *
 * An overlay opened from a control returns focus to that control. One opened by a keyboard shortcut
 * (R, Ctrl K, ?) may have had nothing real behind it: the body, or the page's content container that
 * a route change focuses. Focusing that container makes NVDA read the whole page aloud, so focus goes
 * to the page's main heading instead, which says where you are in one line. */

/** True when what had focus before an overlay is not something worth going back to. */
export function hadNoRealFocus(before: Element | null | undefined): boolean {
  return !before
    || !before.isConnected
    || before === document.body
    || before === document.documentElement
    || before.id === 'content';
}

function visible(node: HTMLElement): boolean {
  if (node.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let part: HTMLElement | null = node; part; part = part.parentElement) {
    const style = getComputedStyle(part);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/** The page's main heading, made focusable from script only, or the content container if the page
 * has no heading. */
export function pageStart(): HTMLElement | null {
  const content = document.getElementById('content');
  const heading = [...(content?.querySelectorAll<HTMLElement>('h1') ?? [])].find(visible);
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    return heading;
  }
  return content;
}

/** Puts focus back on `before`, or on the page's main heading when `before` was nothing real. */
export function returnFocus(before: HTMLElement | null | undefined, replacement?: HTMLElement | null) {
  if (before && !hadNoRealFocus(before)) before.focus({ preventScroll: true });
  else if (replacement) replacement.focus({ preventScroll: true });
  else pageStart()?.focus({ preventScroll: true });
}
