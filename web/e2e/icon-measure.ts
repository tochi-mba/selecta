/**
 * ADR-0277 measurements, read from the real stylesheet in the browser. Each function runs inside the page
 * (page.evaluate), so it is self-contained. Used by mp-0277-icon-geometry.e2e.ts.
 */

export type IconReading = {
  icon: string; size: string; width: number; height: number; stroke: number; hidden: boolean; transform: string;
  where: string; name: string; control: string | null; iconOnly: boolean; inside: boolean; onScreen: boolean;
  hint: boolean; controlWidth: number; controlHeight: number;
};

/** MP-0277-01, -02, -04, -08: every visible icon, its slot and box, its stroke, and what names it. */
export function iconReadings(): IconReading[] {
  const shown = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };
  const words = (element: Element | null) => {
    if (!element) return '';
    const label = element.getAttribute('aria-label');
    if (label?.trim()) return label.trim();
    const by = element.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    return (element.textContent ?? '').trim();
  };
  const out: IconReading[] = [];
  for (const icon of document.querySelectorAll<SVGSVGElement>('svg.ui-icon')) {
    if (!shown(icon) || icon.closest('[aria-hidden="true"]:not(svg), [inert]')) continue;
    const box = icon.getBoundingClientRect();
    const style = getComputedStyle(icon);
    const control = icon.closest<HTMLElement>('button, a, [role="button"], [role="menuitem"], [role="menuitemradio"], summary, .grip');
    // what names it: the control's own name, or the words of the line or field it sits in
    const holder = control ?? icon.parentElement!;
    let name = words(holder);
    if (!name && holder.querySelector('input[aria-label], input[id]')) {
      const input = holder.querySelector<HTMLInputElement>('input')!;
      name = input.getAttribute('aria-label') ?? (input.labels?.[0]?.textContent ?? '');
    }
    if (!name && icon.classList.contains('lucy-mark')) name = words(icon.parentElement!.querySelector('h1, h2'));
    let iconOnly = false;
    if (control) {
      const range = document.createRange();
      range.selectNodeContents(control);
      const seen = [...control.querySelectorAll('*')].filter((child) => child !== icon && !icon.contains(child) && shown(child) && !child.closest('.visually-hidden') && !child.matches('svg, path') && getComputedStyle(child).position !== 'absolute' && (child.textContent ?? '').trim());
      const text = [...control.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      iconOnly = !seen.length && !text;
    }
    const outer = (control ?? icon.parentElement!).getBoundingClientRect();
    const described = control?.getAttribute('aria-describedby');
    const hint = !!control && !!(control.title || control.dataset.tip || (described && document.getElementById(described)?.classList.contains('tooltip')));
    out.push({
      icon: icon.dataset.icon ?? '', size: icon.dataset.size ?? '',
      width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100,
      stroke: parseFloat(style.strokeWidth), hidden: icon.getAttribute('aria-hidden') === 'true', transform: style.transform,
      where: control ? `${control.tagName.toLowerCase()}.${[...control.classList].join('.')} "${words(control).slice(0, 40)}"` : `${icon.parentElement!.tagName.toLowerCase()}.${[...icon.parentElement!.classList].join('.')}`,
      name, control: control ? control.tagName.toLowerCase() : null, iconOnly,
      inside: box.left >= outer.left - 0.5 && box.right <= outer.right + 0.5 && box.top >= outer.top - 0.5 && box.bottom <= outer.bottom + 0.5,
      onScreen: box.left >= -0.5 && box.right <= innerWidth + 0.5,
      hint, controlWidth: outer.width, controlHeight: outer.height,
    });
  }
  return out;
}

/** MP-0277-03: every icon beside its own words, and the gap between them. Dense pairs are the reviewed ones. */
export function labelGaps() {
  const DENSE = '.status, .locked-badge, .music-route, .icon-words, .story-tag, .lucy-proof, .request-results small, .report li';
  const out: Array<{ where: string; gap: number; dense: boolean; stacked: boolean; lines: number; iconWidth: number }> = [];
  for (const icon of document.querySelectorAll<SVGElement>('svg.ui-icon')) {
    const box = icon.getBoundingClientRect();
    const parent = icon.parentElement;
    if (!parent || !box.width || getComputedStyle(parent).visibility === 'hidden') continue;
    // all the words after the icon; in a right-to-left line a left-to-right phrase starts on its far side,
    // so the gap is taken to the nearest edge of the words' first line, whichever node it belongs to
    let node = icon.nextSibling;
    const rects: DOMRect[] = [];
    while (node) {
      const hidden = node instanceof HTMLElement && (node.classList.contains('visually-hidden') || !node.getBoundingClientRect().width);
      if (!hidden && (node.textContent ?? '').trim()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
      }
      node = node.nextSibling;
    }
    if (!rects.length) continue;
    const first = rects[0];
    const lines = new Set(rects.map((rect) => Math.round(rect.top))).size;
    const line = rects.filter((rect) => Math.abs(rect.top - first.top) < 2);
    const stacked = first.top >= box.bottom - 1;
    const rtl = getComputedStyle(parent).direction === 'rtl';
    const near = rtl ? Math.max(...line.map((rect) => rect.right)) : Math.min(...line.map((rect) => rect.left));
    out.push({
      where: `${parent.tagName.toLowerCase()}.${[...parent.classList].join('.')} "${(parent.textContent ?? '').trim().slice(0, 30)}"`,
      gap: Math.round((stacked ? first.top - box.bottom : rtl ? box.left - near : near - box.right) * 10) / 10,
      dense: !!parent.closest(DENSE), stacked, lines, iconWidth: box.width,
    });
  }
  return out;
}

/** MP-0277-05: a counter badge, its icon and its control. */
export function badge(selector: string) {
  const control = document.querySelector<HTMLElement>(selector);
  if (!control || !control.getBoundingClientRect().width) return null;
  const icon = control.querySelector('svg.ui-icon')!.getBoundingClientRect();
  const count = control.querySelector('.count')!.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(control.querySelector('.count')!);
  const glyphs = [...range.getClientRects()].filter((rect) => rect.width > 0);
  const digits = { left: Math.min(...glyphs.map((rect) => rect.left)), right: Math.max(...glyphs.map((rect) => rect.right)) };
  const box = control.getBoundingClientRect();
  const r = (value: number) => Math.round(value * 100) / 100;
  return {
    text: control.querySelector('.count')!.textContent!.trim(),
    controlWidth: r(box.width), controlLeft: r(box.left),
    iconLeft: r(icon.left), iconCy: r(icon.top + icon.height / 2),
    countCx: r(count.left + count.width / 2), countCy: r(count.top + count.height / 2),
    digitsStart: r(getComputedStyle(control).direction === 'rtl' ? digits.right : digits.left),
    inside: count.left >= box.left && count.right <= box.right && count.top >= box.top && count.bottom <= box.bottom,
    onScreen: box.left >= 0 && box.right <= innerWidth,
    after: getComputedStyle(control).direction === 'rtl' ? count.right <= icon.left + 0.5 : count.left >= icon.right - 0.5,
  };
}

/** MP-0277-06: the computed look of one control, for comparing two states. */
export function look(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;
  const style = getComputedStyle(element);
  const icon = element.querySelector('svg.ui-icon');
  return {
    opacity: style.opacity, outline: `${style.outlineStyle} ${style.outlineWidth}`, shadow: style.boxShadow,
    borderWidth: style.borderTopWidth, border: style.borderTopColor, background: style.backgroundColor,
    color: icon ? getComputedStyle(icon).color : style.color, decoration: style.textDecorationLine, weight: style.fontWeight,
    after: getComputedStyle(element, '::after').content, insetShadow: style.boxShadow.includes('inset'),
  };
}

export type Look = NonNullable<ReturnType<typeof look>>;

/** The cues that differ between two looks other than hue: shape, weight, opacity or a change of lightness. */
export function nonHueCues(a: Look, b: Look) {
  const rgba = (value: string) => {
    const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = (value: string, under = { r: 128, g: 128, b: 128 }) => {
    const c = rgba(value);
    const mix = (channel: number, base: number) => (channel * c.a + base * (1 - c.a)) / 255;
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(mix(c.r, under.r)) + 0.7152 * lin(mix(c.g, under.g)) + 0.0722 * lin(mix(c.b, under.b));
  };
  const ratio = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  const cues: string[] = [];
  if (a.opacity !== b.opacity) cues.push('opacity');
  if (a.outline !== b.outline && [a.outline, b.outline].some((value) => !value.startsWith('none') && parseFloat(value.split(' ')[1]) > 0)) cues.push('ring');
  if (a.shadow !== b.shadow) cues.push('shadow');
  if (a.borderWidth !== b.borderWidth) cues.push('edge width');
  if (Math.abs(rgba(a.border).a - rgba(b.border).a) > 0.5 || ratio(luminance(a.border), luminance(b.border)) >= 1.3) cues.push('edge');
  if (Math.abs(rgba(a.background).a - rgba(b.background).a) > 0.3 || ratio(luminance(a.background), luminance(b.background)) >= 1.15) cues.push('fill lightness');
  if (ratio(luminance(a.color), luminance(b.color)) >= 1.3) cues.push('ink lightness');
  if (a.decoration !== b.decoration) cues.push('underline');
  if (a.weight !== b.weight) cues.push('weight');
  if (a.after !== b.after) cues.push('marker');
  return cues;
}
