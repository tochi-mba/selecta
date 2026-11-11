import { Page } from '@playwright/test';

/**
 * ADR-0274 measurements, read from the real stylesheet in the browser. Each function here runs inside the
 * page (page.evaluate), so it is self-contained. Used by mp-0274-optical-alignment.e2e.ts.
 */

export type Edges = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/** MP-0274-01: the page column's content edges, the bar's crumbs and actions, and every anchor found. */
export function pageAnchors(selectors: string[]) {
  const edges = (element: Element | null) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  };
  const main = document.querySelector<HTMLElement>('main#main')!;
  const style = getComputedStyle(main);
  const box = main.getBoundingClientRect();
  const column = { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
  const anchors = selectors.map((selector) => ({ selector, box: edges(document.querySelector(selector)) }))
    .filter((anchor) => anchor.box !== null) as Array<{ selector: string; box: Edges }>;
  // the scope bar bleeds to the bar's edges on purpose; what it holds starts on the column
  const scope = document.querySelector<HTMLElement>('.editor-scope');
  const scopeContent = scope ? scope.getBoundingClientRect().left + parseFloat(getComputedStyle(scope).paddingLeft) : null;
  return {
    column,
    crumbs: edges(document.querySelector('.crumbs')),
    actions: edges(document.querySelector('.context-actions')),
    anchors,
    scopeContent,
    documentWidth: document.documentElement.scrollWidth,
  };
}

/** MP-0274-02: every visible control with an icon, and where its icon and words sit in its hitbox. */
export function iconCentring() {
  const shown = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };
  const out: Array<{ name: string; kind: 'icon' | 'inline' | 'stacked'; centred: boolean; iconDx: number; iconDy: number; groupDx: number; groupDy: number; wordDy: number }> = [];
  for (const control of document.querySelectorAll<HTMLElement>('button, a.button, .nav li a, a.context-button')) {
    if (!shown(control) || control.closest('[aria-hidden="true"], [inert]')) continue;
    const icon = [...control.querySelectorAll('svg.ui-icon, i')].find(shown);
    if (!icon) continue;
    const iconBox = icon.getBoundingClientRect();
    const style = getComputedStyle(control);
    const outer = control.getBoundingClientRect();
    const inner = {
      left: outer.left + parseFloat(style.borderLeftWidth), right: outer.right - parseFloat(style.borderRightWidth),
      top: outer.top + parseFloat(style.borderTopWidth), bottom: outer.bottom - parseFloat(style.borderBottomWidth),
    };
    const words: DOMRect[] = [];
    for (const child of control.childNodes) {
      if (child === icon) continue;
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        const range = document.createRange();
        range.selectNodeContents(child);
        words.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
      } else if (child instanceof Element && shown(child) && !child.classList.contains('visually-hidden') && getComputedStyle(child).position !== 'absolute') {
        words.push(child.getBoundingClientRect());
      }
    }
    const all = [iconBox, ...words];
    const group = {
      left: Math.min(...all.map((rect) => rect.left)), right: Math.max(...all.map((rect) => rect.right)),
      top: Math.min(...all.map((rect) => rect.top)), bottom: Math.max(...all.map((rect) => rect.bottom)),
    };
    const stacked = words.length > 0 && words[0].top >= iconBox.bottom - 1;
    const cx = (inner.left + inner.right) / 2;
    const cy = (inner.top + inner.bottom) / 2;
    const round = (value: number) => Math.round(value * 100) / 100;
    out.push({
      name: `${control.tagName.toLowerCase()}.${String(control.className).trim().split(/\s+/).join('.')} "${(control.getAttribute('aria-label') ?? control.textContent ?? '').trim().slice(0, 28)}"`,
      kind: !words.length ? 'icon' : stacked ? 'stacked' : 'inline',
      centred: style.justifyContent === 'center' || (style.display.includes('block') && style.textAlign === 'center'),
      iconDx: round((iconBox.left + iconBox.right) / 2 - cx),
      iconDy: round((iconBox.top + iconBox.bottom) / 2 - cy),
      groupDx: round((group.left + group.right) / 2 - cx),
      groupDy: round((group.top + group.bottom) / 2 - cy),
      wordDy: words.length && !stacked ? round((iconBox.top + iconBox.bottom) / 2 - (words[0].top + words[0].bottom) / 2) : 0,
    });
  }
  return out;
}

/** MP-0274-04: rows of two or more buttons that share a line, and how far their tops and bottoms differ. */
export function buttonRows() {
  const shown = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };
  const parents = new Set([...document.querySelectorAll('main button, main a.button')].filter(shown).map((button) => button.parentElement!));
  const rows: Array<{ where: string; count: number; wrapped: boolean; top: number; bottom: number }> = [];
  for (const parent of parents) {
    const buttons = [...parent.children].filter((child) => child.matches('button, a.button') && shown(child)).map((child) => {
      const range = document.createRange();
      range.selectNodeContents(child);
      const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
      return { box: child.getBoundingClientRect(), lines };
    });
    const lines: Array<{ top: number; bottom: number; items: typeof buttons }> = [];
    for (const button of buttons) {
      const line = lines.find((entry) => button.box.top < entry.bottom - 1 && button.box.bottom > entry.top + 1);
      if (line) {
        line.items.push(button);
        line.top = Math.min(line.top, button.box.top);
        line.bottom = Math.max(line.bottom, button.box.bottom);
      } else lines.push({ top: button.box.top, bottom: button.box.bottom, items: [button] });
    }
    for (const line of lines.filter((entry) => entry.items.length > 1)) {
      const spread = (values: number[]) => Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10;
      rows.push({
        where: `${parent.tagName.toLowerCase()}.${String(parent.className).trim().split(/\s+/).join('.')}`,
        count: line.items.length,
        wrapped: line.items.some((item) => item.lines > 1),
        top: spread(line.items.map((item) => item.box.top)),
        bottom: spread(line.items.map((item) => item.box.bottom)),
      });
    }
  }
  return rows;
}

/** MP-0274-04: idea cards that share a grid row, and where each one's action row ends. */
export function cardFooters() {
  const rows: Array<{ cards: number; actionBottoms: number[]; cardBottoms: number[] }> = [];
  for (const grid of document.querySelectorAll('.vibe-group .cards')) {
    const byTop = new Map<number, Array<{ action: number; card: number }>>();
    for (const card of grid.querySelectorAll(':scope > .vibe-card')) {
      const box = card.getBoundingClientRect();
      const actions = card.querySelector(':scope > .card-actions')?.getBoundingClientRect();
      if (!box.width || !actions) continue;
      const key = Math.round(box.top);
      byTop.set(key, [...(byTop.get(key) ?? []), { action: actions.bottom, card: box.bottom }]);
    }
    for (const cards of byTop.values()) rows.push({ cards: cards.length, actionBottoms: cards.map((card) => card.action), cardBottoms: cards.map((card) => card.card) });
  }
  return rows;
}

/** MP-0274-05: doubled 1px edges that are actually on top (hit-tested), and boxes with uneven corners. */
export function borderJoins() {
  const shown = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && !element.closest('details:not([open]) > :not(summary)');
  };
  const name = (element: Element) => `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/).join('.')}`;
  const edge = (style: CSSStyleDeclaration, side: 'Top' | 'Right' | 'Bottom' | 'Left') =>
    parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none' && style[`border${side}Color`] !== 'rgba(0, 0, 0, 0)';
  const owns = (element: Element, x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === element || element.contains(hit));
  };
  const elements = [...document.querySelectorAll('body *')].filter((element) => !(element instanceof SVGElement) && shown(element));
  const bordered = elements.filter((element) => {
    const style = getComputedStyle(element);
    return edge(style, 'Top') || edge(style, 'Bottom') || edge(style, 'Left') || edge(style, 'Right');
  });
  const doubled: string[] = [];
  const corners: Array<{ name: string; radii: string[] }> = [];
  for (const a of bordered) {
    const sa = getComputedStyle(a);
    const ra = a.getBoundingClientRect();
    if ((['Top', 'Right', 'Bottom', 'Left'] as const).every((side) => edge(sa, side))) {
      const radii = [sa.borderTopLeftRadius, sa.borderTopRightRadius, sa.borderBottomRightRadius, sa.borderBottomLeftRadius];
      if (new Set(radii).size > 1) corners.push({ name: name(a), radii });
    }
    for (const b of bordered) {
      if (a === b || a.contains(b) || b.contains(a)) continue;
      const sb = getComputedStyle(b);
      const rb = b.getBoundingClientRect();
      const acrossX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const acrossY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (edge(sa, 'Bottom') && edge(sb, 'Top') && Math.abs(ra.bottom - rb.top) < 0.6 && acrossX > 8) {
        const x = Math.max(ra.left, rb.left) + acrossX / 2;
        if (owns(a, x, ra.bottom - 0.5) && owns(b, x, rb.top + 0.5)) doubled.push(`${name(a)} bottom meets ${name(b)} top`);
      }
      if (edge(sa, 'Right') && edge(sb, 'Left') && Math.abs(ra.right - rb.left) < 0.6 && acrossY > 8) {
        const y = Math.max(ra.top, rb.top) + acrossY / 2;
        if (owns(a, ra.right - 0.5, y) && owns(b, rb.left + 0.5, y)) doubled.push(`${name(a)} right meets ${name(b)} left`);
      }
    }
  }
  return { doubled: [...new Set(doubled)], corners };
}

/** MP-0274-05: focus every visible control from the keyboard and report any ring a scroller cuts off. */
export async function clippedRings(page: Page) {
  await page.keyboard.press('Shift');
  const count = await page.evaluate(() => {
    const list = [...document.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not([type=hidden]):not(:disabled), select, textarea, summary, [tabindex="0"]')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 1 && box.height > 1 && getComputedStyle(element).visibility !== 'hidden'
          && !element.closest('[inert], [aria-hidden="true"], details:not([open]) > :not(summary)')
          && !element.classList.contains('visually-hidden') && !element.classList.contains('skip-link');
      });
    (window as unknown as { ringTargets: HTMLElement[] }).ringTargets = list;
    return list.length;
  });
  const problems: string[] = [];
  let rings = 0;
  for (let index = 0; index < count; index += 1) {
    const found = await page.evaluate((at) => {
      const element = (window as unknown as { ringTargets: HTMLElement[] }).ringTargets[at];
      if (!element?.isConnected) return null;
      element.focus({ preventScroll: true });
      if (document.activeElement !== element || !element.matches(':focus-visible')) return null;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const style = getComputedStyle(element);
      const label = `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/).join('.')} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 28)}"`;
      const width = style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth) || 0;
      const spread = Math.max(0, ...[...style.boxShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].map((match) => Number(match[4])));
      if (!width && !spread) return { label, cut: ['no focus ring'] };
      const grow = Math.max(width ? width + (parseFloat(style.outlineOffset) || 0) : 0, spread);
      if (grow <= 0) return { label, cut: [] }; // drawn inside the control: nothing can cut it
      const box = element.getBoundingClientRect();
      const ring = { left: box.left - grow, right: box.right + grow, top: box.top - grow, bottom: box.bottom + grow };
      const cut: string[] = [];
      for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
        const ps = getComputedStyle(parent);
        if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue;
        const pb = parent.getBoundingClientRect();
        const clip = {
          left: pb.left + parent.clientLeft, right: pb.left + parent.clientLeft + parent.clientWidth,
          top: pb.top + parent.clientTop, bottom: pb.top + parent.clientTop + parent.clientHeight,
        };
        const where = `${parent.tagName.toLowerCase()}.${String(parent.className).trim().split(/\s+/).join('.')}`;
        if (ps.overflowX !== 'visible' && ring.left < clip.left - 0.5 && box.left >= clip.left - 0.5) cut.push(`${where} left`);
        if (ps.overflowX !== 'visible' && ring.right > clip.right + 0.5 && box.right <= clip.right + 0.5) cut.push(`${where} right`);
        if (ps.overflowY !== 'visible' && ring.top < clip.top - 0.5 && box.top >= clip.top - 0.5) cut.push(`${where} top`);
        if (ps.overflowY !== 'visible' && ring.bottom > clip.bottom + 0.5 && box.bottom <= clip.bottom + 0.5) cut.push(`${where} bottom`);
      }
      return { label, cut };
    }, index);
    if (!found) continue;
    rings += 1;
    if (found.cut.length) problems.push(`${found.label}: ${found.cut.join(', ')}`);
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return { rings, problems: [...new Set(problems)] };
}

/** MP-0274-06 and -07: where the shell's fixed and sticky pieces are right now. */
export function chrome() {
  const edges = (selector: string) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  };
  return {
    headerBlock: getComputedStyle(document.documentElement).getPropertyValue('--header-block').trim(),
    header: edges('.context-bar'),
    crumbs: edges('.crumbs'),
    actions: edges('.context-actions'),
    nav: edges('.nav'),
    main: edges('main#main'),
    scope: edges('.editor-scope'),
    editorHead: edges('.editor-head'),
    inspector: edges('.edit-inspector'),
    identity: edges('.inspector-identity'),
    tabs: edges('.inspector-tabs, [role="tablist"]'),
    studioHead: edges('.studio-head'),
    ruler: edges('.studio-ruler'),
    rulerName: edges('.studio-ruler .studio-name'),
    grid: edges('.studio-grid'),
    side: edges('.listen-side'),
  };
}
