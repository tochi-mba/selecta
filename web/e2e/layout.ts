import { Page } from '@playwright/test';

/** What looks unfinished on a page, by name: the marks a removed feature leaves behind when the page
 * around it hasn't closed up. Empty is fine; nothing here is about what a page is for, only whether
 * its pieces still fit together.
 *
 *  - a visible container with nothing in it
 *  - a row of tabs with fewer than two
 *  - a heading with nothing under it
 *  - a grid that assumes more children than it has, leaving a lone child in a row meant for several
 */
export async function layoutProblems(page: Page, where: string): Promise<string[]> {
  return page.evaluate((place) => {
    const found: string[] = [];
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // what's inside a closed <details> isn't on screen, whatever its box says
      const folded = element.parentElement?.closest('details:not([open])');
      const inFold = !!folded && !(element.tagName === 'SUMMARY' && element.parentElement === folded);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !inFold && !element.closest('[aria-hidden="true"]');
    };
    const name = (element: Element) => {
      const label = element.getAttribute('aria-label');
      return `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().split(/\s+/).join('.')}` : ''}${label ? `[${label}]` : ''}`;
    };
    const filled = (element: Element) =>
      !!(element as HTMLElement).innerText?.trim() || (element.tagName === 'DETAILS' && !!element.querySelector('summary')?.textContent?.trim()) || !!element.querySelector('img,svg,canvas,input,select,textarea,button,audio,video,progress,meter');

    const containers = 'main section, main article, main details, main fieldset, main .card, main .panel, main .row, main [role="group"], main [role="toolbar"], main .card-actions, main .editor-actions, main .listen-side, main .metrics, .context-actions, .nav-foot, .mini, .overlay section';
    for (const element of document.querySelectorAll(containers)) {
      if (shown(element) && !filled(element)) found.push(`${place}: empty ${name(element)}`);
    }

    for (const tabs of document.querySelectorAll('nav.tabs, [role="tablist"]')) {
      if (!shown(tabs)) continue;
      const items = [...tabs.querySelectorAll('a, [role="tab"]')].filter(shown);
      if (items.length < 2) found.push(`${place}: ${items.length} tab in ${name(tabs)}`);
    }

    for (const heading of document.querySelectorAll('main h2, main h3, .overlay h2, .overlay h3')) {
      if (!shown(heading)) continue;
      const holder = heading.parentElement;
      if (!holder) continue;
      const rest = (holder as HTMLElement).innerText.replace((heading as HTMLElement).innerText, '').trim();
      const controls = [...holder.querySelectorAll('button,a,input,select,canvas,audio')].some((control) => !heading.contains(control) && shown(control));
      if (!rest && !controls && holder.children.length > 1) found.push(`${place}: nothing under “${(heading as HTMLElement).innerText.trim()}”`);
    }

    // a grid laid out for several children with only one, or a last one stranded on its own row
    for (const grid of document.querySelectorAll('main *, .overlay *')) {
      const style = getComputedStyle(grid);
      if (style.display !== 'grid' || !shown(grid)) continue;
      const tracks = style.gridTemplateColumns.split(' ').filter((track) => track && track !== '0px');
      if (tracks.length < 2) continue;
      const kids = [...grid.children].filter(shown);
      if (!kids.length) continue;
      const width = grid.getBoundingClientRect().width;
      const lastKid = kids[kids.length - 1];
      const last = lastKid.getBoundingClientRect();
      // a last child the stylesheet deliberately gives the whole row isn't stranded
      const spans = getComputedStyle(lastKid).gridColumnEnd === '-1';
      const alone = kids.filter((kid) => Math.abs(kid.getBoundingClientRect().top - last.top) < 2).length === 1;
      const meantToFill = grid.matches('.editor-actions, .card-actions, .listen-display-toggles, .mix-paths, .listen-intensity-choices');
      if (kids.length === 1 && last.width < width * 0.6 && meantToFill) found.push(`${place}: one child in a ${tracks.length}-column ${name(grid)}`);
      else if (meantToFill && kids.length > 1 && alone && !spans && last.width < width * 0.6) found.push(`${place}: last child alone in ${name(grid)}`);
    }
    return found;
  }, where);
}
