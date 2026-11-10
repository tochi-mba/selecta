import { Page } from '@playwright/test';

/** MP-0272-02 and -06: what the page measures as, and what in it is measurably wrong.
 *
 * Geometry is computed CSS and element rectangles, read from the browser, never inferred from source.
 * Defects are rules with a severity, the element's short selector, the measured value and the target:
 *
 *  - P0 `page-overflow`: an element sticks out of the window and the page scrolls sideways
 *  - P0 `overlay-off-screen`: an open overlay panel does not fit inside the window
 *  - P0 `unreachable-control`: with the page scrolled to the very end, a control still sits under fixed
 *    chrome (mini-player, bottom navigation, header), so it can never be pressed
 *  - P1 `cut-off`: an element sticks out of the window and is clipped, with no scroll to reach it
 *  - P1 `target-size`: a control smaller than 24 x 24 CSS px (WCAG 2.2 2.5.8), not inline in text and
 *    not inside a label that is itself big enough
 *  - P1 `clipped-text`: text cut off sideways with no ellipsis
 *  - P1 `fixed-overlap`: two pieces of fixed chrome cover each other
 *  - P2 `truncated-no-full-text`: an ellipsis with no title or accessible name holding the whole text
 *  - P2 `touch-target`: a control under 44 CSS px on a touch-sized layout (width at most 768)
 */

export const SELECTORS = [
  '.nav', '.context-bar', '.crumbs', '.context-actions', '.content', '.page', 'main h1',
  '.display', '.lede', '.card', '.panel', '.song-row', '.song-actions', '.transport', '.strip',
  '.lyrics', '.mini', '.mini-song', '.connection', '.problem', '.toasts', '.overlay-panel',
  '.overlay-head', '.overlay-body', '.overlay-foot', '.stage-controls', '.timeline .song',
  '.studio-list', '.library-rows', '.request-tag',
] as const;

export type Box = { x: number; y: number; width: number; height: number };
export type Geometry = {
  selector: string; count: number; box: Box;
  css: {
    margin: string; padding: string; gap: string; borderWidth: string; borderRadius: string;
    fontSize: string; lineHeight: string; fontWeight: string; letterSpacing: string; fontFamily: string;
    display: string; position: string;
  };
};
export type Defect = { rule: string; severity: 'P0' | 'P1' | 'P2'; selector: string; measured: string; target: string };
export type Reading = { documentWidth: number; documentHeight: number; geometry: Geometry[]; defects: Defect[] };

/** Measure the page as it is now. Scrolls to the end and back to find controls fixed chrome hides. */
export async function measure(page: Page): Promise<Reading> {
  // let overlay and route animations come to rest, so a box is where it stays
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))));
  return page.evaluate((selectors) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const round = (value: number) => Math.round(value * 10) / 10;
    const boxOf = (element: Element): Box => {
      const box = element.getBoundingClientRect();
      return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
    };
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        && !element.closest('[aria-hidden="true"], [inert], details:not([open]) > :not(summary)');
    };
    // a short, stable name: tag and up to two classes, or the nearest classed ancestor and the tag
    const nameOf = (element: Element): string => {
      const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      const tag = element.tagName.toLowerCase();
      if (classes.length) return `${tag}.${classes.join('.')}`;
      const holder = element.parentElement?.closest('[class]');
      const outer = holder && typeof holder.className === 'string' ? holder.className.trim().split(/\s+/)[0] : '';
      return outer ? `.${outer} ${tag}` : tag;
    };

    const geometry: Geometry[] = [];
    for (const selector of selectors) {
      const all = [...document.querySelectorAll(selector)].filter(shown);
      if (!all.length) continue;
      const css = getComputedStyle(all[0]);
      geometry.push({
        selector, count: all.length, box: boxOf(all[0]),
        css: {
          margin: css.margin, padding: css.padding, gap: css.gap, borderWidth: css.borderWidth, borderRadius: css.borderRadius,
          fontSize: css.fontSize, lineHeight: css.lineHeight, fontWeight: css.fontWeight, letterSpacing: css.letterSpacing,
          fontFamily: css.fontFamily.split(',')[0].trim(), display: css.display, position: css.position,
        },
      });
    }

    const defects: Defect[] = [];
    const add = (defect: Defect) => {
      if (!defects.some((seen) => seen.rule === defect.rule && seen.selector === defect.selector)) defects.push(defect);
    };
    const pageScrolls = document.documentElement.scrollWidth > vw + 1;
    const elements = [...document.querySelectorAll('body *')].filter(shown);
    const contained = (element: Element) => {
      for (let up = element.parentElement; up && up !== document.body; up = up.parentElement) {
        const overflow = getComputedStyle(up).overflowX;
        if (overflow !== 'visible' && up.getBoundingClientRect().right <= vw + 1) return true;
      }
      return false;
    };
    const sticksOut = (element: Element) => {
      const box = element.getBoundingClientRect();
      return (box.right > vw + 1 || box.left < -1) && getComputedStyle(element).position !== 'fixed' && !contained(element);
    };
    for (const element of elements) {
      if (!sticksOut(element) || (element.parentElement && sticksOut(element.parentElement))) continue;
      if (element.matches('.skip, .skip-link, .visually-hidden, .sr-only')) continue;
      const box = element.getBoundingClientRect();
      add({
        rule: pageScrolls ? 'page-overflow' : 'cut-off', severity: pageScrolls ? 'P0' : 'P1', selector: nameOf(element),
        measured: `left ${round(box.left)} right ${round(box.right)} in ${vw}`, target: `inside 0..${vw}`,
      });
    }

    for (const panel of document.querySelectorAll('.overlay-panel')) {
      if (!shown(panel)) continue;
      const box = panel.getBoundingClientRect();
      if (box.left < -1 || box.top < -1 || box.right > vw + 1 || box.bottom > vh + 1) {
        add({ rule: 'overlay-off-screen', severity: 'P0', selector: `${nameOf(panel.parentElement ?? panel)} .overlay-panel`, measured: `${round(box.left)},${round(box.top)} ${round(box.width)}x${round(box.height)} in ${vw}x${vh}`, target: `inside ${vw}x${vh}` });
      }
    }

    const CONTROLS = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="slider"], [role="switch"]';
    for (const control of document.querySelectorAll<HTMLElement>(CONTROLS)) {
      if (!shown(control)) continue;
      const style = getComputedStyle(control);
      if (control.tagName === 'A' && style.display === 'inline') continue; // inline in a sentence
      const box = control.getBoundingClientRect();
      const label = control.closest('label');
      const labelBox = label?.getBoundingClientRect();
      const small = Math.min(box.width, box.height);
      const labelSmall = labelBox ? Math.min(labelBox.width, labelBox.height) : 0;
      const effective = Math.max(small, labelSmall);
      if (effective < 24) {
        add({ rule: 'target-size', severity: 'P1', selector: nameOf(control), measured: `${round(box.width)}x${round(box.height)}`, target: '>= 24x24 (WCAG 2.5.8)' });
      } else if (vw <= 768 && effective < 44) {
        add({ rule: 'touch-target', severity: 'P2', selector: nameOf(control), measured: `${round(box.width)}x${round(box.height)}`, target: '>= 44x44 on touch layouts' });
      }
    }

    for (const element of elements) {
      const text = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (!text || element.matches('input, textarea, select')) continue;
      // screen-reader-only text is a 1px clipped box on purpose, not text a sighted reader loses
      if (element.clientWidth <= 1 || element.clientHeight <= 1) continue;
      const style = getComputedStyle(element);
      if (style.overflowX === 'visible' || element.scrollWidth <= element.clientWidth + 1 || style.display === 'inline') continue;
      if (style.textOverflow !== 'ellipsis') {
        add({ rule: 'clipped-text', severity: 'P1', selector: nameOf(element), measured: `scroll ${element.scrollWidth} in ${element.clientWidth}`, target: 'wrap or ellipsis' });
      } else if (!element.closest('[title]') && !element.closest('[aria-label]')) {
        add({ rule: 'truncated-no-full-text', severity: 'P2', selector: nameOf(element), measured: `scroll ${element.scrollWidth} in ${element.clientWidth}`, target: 'title or accessible full text' });
      }
    }

    const CHROME = ['.mini', '.nav', '.context-bar', '.connection', '.toasts', '.stage-controls'];
    const fixed = CHROME.flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => shown(element) && ['fixed', 'sticky'].includes(getComputedStyle(element).position));
    for (let i = 0; i < fixed.length; i += 1) {
      for (let j = i + 1; j < fixed.length; j += 1) {
        if (fixed[i].contains(fixed[j]) || fixed[j].contains(fixed[i])) continue;
        const a = fixed[i].getBoundingClientRect();
        const b = fixed[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2) add({ rule: 'fixed-overlap', severity: 'P1', selector: `${nameOf(fixed[i])} | ${nameOf(fixed[j])}`, measured: `${round(w)}x${round(h)} overlap`, target: 'no overlap' });
      }
    }

    // scrolled to the very end, nothing that can be pressed may still sit under fixed chrome
    const scroller = document.scrollingElement ?? document.documentElement;
    const before = scroller.scrollTop;
    scroller.scrollTop = scroller.scrollHeight;
    const blockers = fixed.filter((element) => element.matches('.mini, .nav, .context-bar, .connection'));
    for (const control of document.querySelectorAll<HTMLElement>(CONTROLS)) {
      if (!shown(control) || control.closest('.mini, .nav, .context-bar, .connection, .toasts, .overlay')) continue;
      if (document.querySelector('.overlay')) break; // an open overlay makes the page behind it inert
      const box = control.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (y < 0 || y > vh || x < 0 || x > vw) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || control.contains(hit) || hit.contains(control)) continue;
      const cover = blockers.find((blocker) => blocker.contains(hit));
      // only the end of the page counts: a control further up scrolls out from under the chrome
      if (cover && box.bottom > vh - cover.getBoundingClientRect().height - 1 && scroller.scrollTop + vh >= scroller.scrollHeight - 2) {
        add({ rule: 'unreachable-control', severity: 'P0', selector: `${nameOf(control)} under ${nameOf(cover)}`, measured: `centre ${round(x)},${round(y)} covered at full scroll`, target: 'reachable above fixed chrome' });
      }
    }
    scroller.scrollTop = before;

    return {
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      geometry,
      defects,
    };
  }, [...SELECTORS]);
}
