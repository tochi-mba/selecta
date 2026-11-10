/**
 * In-page measuring for ADR-0276 (surface depth, borders, shadows and accent hierarchy). Each export is
 * passed to page.evaluate, so it carries its own helpers and reads only the live stylesheet. Colours are
 * read back from a 1x1 canvas, so rgb(), color(srgb) and color-mix() all resolve to the same numbers.
 */

export type Rgba = [number, number, number, number];

/** Every measurement shares these helpers; each export calls `kit()` first. */
function kit() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const rgba = (value: string): Rgba => {
    if (!value || value === 'transparent' || value === 'none') return [0, 0, 0, 0];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = '#000';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, Math.round((a / 255) * 1000) / 1000];
  };
  const over = (top: Rgba, under: Rgba): Rgba => {
    const a = top[3];
    return [0, 1, 2].map((i) => Math.round(top[i] * a + under[i] * (1 - a))).concat(1) as Rgba;
  };
  const luminance = ([r, g, b]: Rgba) => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a: Rgba, b: Rgba) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  /** what a background token resolves to here */
  const token = (name: string): Rgba => {
    const probe = document.createElement('div');
    probe.style.background = `var(${name})`;
    document.body.append(probe);
    const value = rgba(getComputedStyle(probe).backgroundColor);
    probe.remove();
    return value;
  };
  /** the colour actually behind an element: the nearest ancestor that paints a background */
  const behind = (element: Element | null): Rgba => {
    let layers: Rgba[] = [];
    for (let node = element; node; node = node.parentElement) {
      const colour = rgba(getComputedStyle(node).backgroundColor);
      if (colour[3] > 0) layers.push(colour);
      if (colour[3] >= 1) break;
    }
    if (!layers.length || layers.at(-1)![3] < 1) layers.push(rgba(getComputedStyle(document.body).backgroundColor));
    layers = layers.reverse();
    return layers.slice(1).reduce((under, top) => over(top, under), layers[0]);
  };
  const shadows = (value: string) => (value === 'none' ? [] : value.split(/,(?![^(]*\))/).map((layer) => {
    const colour = layer.match(/(rgba?\([^)]*\)|color\([^)]*\))/)?.[0] ?? '';
    const numbers = layer.replace(colour, '').match(/-?[\d.]+px/g)?.map(Number.parseFloat) ?? [];
    return { colour: rgba(colour), x: numbers[0] ?? 0, y: numbers[1] ?? 0, blur: numbers[2] ?? 0, spread: numbers[3] ?? 0, inset: /inset/.test(layer) };
  }));
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && css.visibility !== 'hidden' && css.display !== 'none' && Number(css.opacity) > 0;
  };
  const name = (element: Element) => `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join('')}`;
  const same = (a: Rgba, b: Rgba, tolerance = 2) => a.every((value, i) => Math.abs(value - b[i]) <= (i === 3 ? 0.02 : tolerance));
  const sides = (css: CSSStyleDeclaration) => (['top', 'right', 'bottom', 'left'] as const).map((side) => {
    const width = Number.parseFloat(css.getPropertyValue(`border-${side}-width`));
    const colour = rgba(css.getPropertyValue(`border-${side}-color`));
    return { side, width, colour, shown: width > 0 && css.getPropertyValue(`border-${side}-style`) !== 'none' && colour[3] > 0 };
  });
  return { rgba, over, contrast, token, behind, shadows, visible, name, same, sides };
}

export const kitSource = kit.toString();

/** Surface roles: what each role token resolves to, and the backgrounds real surfaces paint. */
export function surfaceRoles(samples: Record<string, string>) {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  const roles = Object.fromEntries(['--surface-base', '--surface-raised', '--surface-control', '--surface-panel', '--surface-overlay', '--surface-scrim']
    .map((role) => [role, k.token(role)]));
  const painted = Object.fromEntries(Object.entries(samples).map(([label, selector]) => {
    const element = [...document.querySelectorAll(selector)].find(k.visible);
    return [label, element ? k.rgba(getComputedStyle(element).backgroundColor) : null];
  }));
  return { roles, painted };
}

/** Nested frames and competing border + shadow + background combinations among visible surfaces. */
export function panelNoise() {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  const control = 'button, input, select, textarea, summary, a.button, [role=tab], option, label, kbd, .pill, .request-tag, .story-tag';
  const framed = (element: Element) => {
    const css = getComputedStyle(element);
    return k.sides(css).every((side) => side.shown) && k.rgba(css.backgroundColor)[3] > 0;
  };
  const nested: string[] = [];
  const triple: string[] = [];
  let frames = 0;
  for (const element of document.querySelectorAll('main *, .nav *, .mini *, .overlay *')) {
    if (!k.visible(element) || element.matches(control)) continue;
    const css = getComputedStyle(element);
    const outer = k.shadows(css.boxShadow).filter((layer) => !layer.inset && layer.colour[3] > 0);
    if (!framed(element)) continue;
    frames += 1;
    if (outer.length && !element.matches('.overlay-panel, .popover-panel, .menu-list, .toast-row, .tooltip, .lucy-new')) triple.push(k.name(element));
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.matches(control)) break;
      if (framed(parent)) {
        // a frame inside a frame of the very same colour is a second box saying nothing new
        if (k.same(k.rgba(css.backgroundColor), k.rgba(getComputedStyle(parent).backgroundColor))) nested.push(`${k.name(element)} in ${k.name(parent)}`);
        break;
      }
    }
  }
  return { frames, nested: [...new Set(nested)], triple: [...new Set(triple)] };
}

/** Every corner radius in use, by value, with the elements that use it. */
export function radii(roles: Record<string, string>) {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  const used: Record<string, string[]> = {};
  for (const element of document.querySelectorAll('body *')) {
    if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
    if (!k.visible(element)) continue;
    const value = getComputedStyle(element).borderTopLeftRadius;
    (used[value] ??= []).push(k.name(element));
  }
  const byRole = Object.fromEntries(Object.entries(roles).map(([role, selector]) => [role,
    [...new Set([...document.querySelectorAll(selector)].filter(k.visible).map((element) => getComputedStyle(element).borderTopLeftRadius))]]));
  return { used: Object.fromEntries(Object.entries(used).map(([value, names]) => [value, [...new Set(names)].slice(0, 12)])), byRole };
}

/** Where pure brand lime is painted, and whether each use carries a meaning. */
export function limeUses(allowed: string) {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  const lime = k.rgba('#e8ff3a');
  const isLime = (colour: Rgba) => colour[3] > 0.5 && k.same(colour, lime, 4);
  const uses: { name: string; how: string; meaningful: boolean }[] = [];
  let filled = 0;
  for (const element of document.querySelectorAll('body *')) {
    if (!k.visible(element)) continue;
    const css = getComputedStyle(element);
    const how: string[] = [];
    if (isLime(k.rgba(css.backgroundColor))) {
      how.push('fill');
      const box = element.getBoundingClientRect();
      filled += box.width * box.height;
    }
    const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
    const drawn = element instanceof SVGElement;
    if ((ownText || drawn) && isLime(k.rgba(css.color))) how.push('ink');
    if (drawn && (isLime(k.rgba(css.fill)) || isLime(k.rgba(css.stroke)))) how.push('ink');
    if (k.sides(css).some((side) => side.shown && isLime(side.colour))) how.push('edge');
    if (css.outlineStyle !== 'none' && Number.parseFloat(css.outlineWidth) > 0 && isLime(k.rgba(css.outlineColor))) how.push('ring');
    if (k.shadows(css.boxShadow).some((layer) => isLime(layer.colour))) how.push('shadow');
    if (!how.length) continue;
    uses.push({ name: k.name(element), how: [...new Set(how)].join('+'), meaningful: !!element.closest(allowed) });
  }
  return { uses, filledShare: filled / (innerWidth * innerHeight), motif: k.token('--motif'), lime };
}

/** An overlay's surface, edge and shadow against what it sits on. */
export function overlayDepth(selector: string, scrim: boolean) {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  const element = [...document.querySelectorAll(selector)].find(k.visible);
  if (!element) return null;
  const css = getComputedStyle(element);
  const base = k.token('--surface-base');
  const backdrop = scrim ? k.over(k.token('--surface-scrim'), base) : base;
  const surface = k.rgba(css.backgroundColor);
  const edge = k.sides(css).find((side) => side.shown);
  return {
    surface,
    raised: k.token('--surface-raised'),
    shadows: k.shadows(css.boxShadow),
    edgeWidth: edge?.width ?? 0,
    edgeContrast: edge ? k.contrast(k.over(edge.colour, backdrop), backdrop) : 0,
    surfaceContrast: k.contrast(k.over(surface, backdrop), backdrop),
    radius: css.borderTopLeftRadius,
  };
}

/** Decorative one-sided rules on a page, against the selected marker and the focus ring beside them. */
export function separators(markerSelector: string, focusSelector: string | null) {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  const state = '[aria-current]:not([aria-current="false"]), [aria-selected="true"], [aria-pressed="true"], .now, .open, .selected, .playing, .is-selected, .attention';
  const rules: { name: string; width: number; contrast: number }[] = [];
  for (const element of document.querySelectorAll('main *')) {
    if (!k.visible(element) || element.matches(state)) continue;
    const css = getComputedStyle(element);
    const shown = k.sides(css).filter((side) => side.shown);
    // a separator draws one line along the top or bottom of something; a frame draws all four
    if (shown.length !== 1 || !['top', 'bottom'].includes(shown[0].side)) continue;
    const ground = k.behind(element);
    rules.push({ name: k.name(element), width: shown[0].width, contrast: k.contrast(k.over(shown[0].colour, ground), ground) });
  }
  const marked = [...document.querySelectorAll(markerSelector)].find(k.visible);
  let marker = null;
  if (marked) {
    const css = getComputedStyle(marked);
    const bar = k.shadows(css.boxShadow).find((layer) => layer.inset && layer.x > 0);
    const ground = k.rgba(css.backgroundColor);
    marker = bar ? { width: bar.x, contrast: k.contrast(k.over(bar.colour, ground), k.behind(marked.parentElement)) } : null;
  }
  const focused = focusSelector ? document.activeElement : null;
  let ring = null;
  if (focused && focused !== document.body) {
    const css = getComputedStyle(focused);
    ring = { name: k.name(focused), style: css.outlineStyle, width: Number.parseFloat(css.outlineWidth), contrast: k.contrast(k.rgba(css.outlineColor), k.behind(focused.parentElement)) };
  }
  return { rules, marker, ring };
}

/** A state's non-colour cues: marker bars, rings, borders, an icon and the words it carries. */
export function stateCues(selector: string) {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  return [...document.querySelectorAll(selector)].filter(k.visible).map((element) => {
    const css = getComputedStyle(element);
    const bar = k.shadows(css.boxShadow).find((layer) => layer.inset && layer.x > 0);
    return {
      name: k.name(element),
      text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      icon: !!element.querySelector('svg'),
      bar: bar ? bar.x : 0,
      barColour: bar ? bar.colour : null,
      startBorder: Number.parseFloat(css.borderLeftWidth),
      startStyle: css.borderLeftStyle,
      outline: css.outlineStyle === 'none' ? 0 : Number.parseFloat(css.outlineWidth),
      outlineStyle: css.outlineStyle,
      colour: k.rgba(css.color),
      outlineColour: k.rgba(css.outlineColor),
      ground: k.behind(element.parentElement),
      background: k.rgba(css.backgroundColor),
    };
  });
}

/** Contrast of a colour against a ground, from the page (so both are read the same way). */
export function contrastOf(pair: [Rgba, Rgba]) {
  const k = (new Function(`return (${(window as unknown as { __depthKit: string }).__depthKit})()`))() as ReturnType<typeof kit>;
  return k.contrast(k.over(pair[0], pair[1]), pair[1]);
}
