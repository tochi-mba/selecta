import { ButtonHTMLAttributes, InputHTMLAttributes, KeyboardEvent, ReactNode, RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageLink } from '../shell/PageLink';
import { Icon, IconName } from './Icon';
import { usePresence } from './exitMotion';
import { feelOn } from '../feel/root';
import { INDICATOR_CLASS, useSlidingIndicator } from '../feel/indicator';
import { tick } from '../feel/haptics';

/** The smaller building blocks. Each one has one job and one way of behaving, so every page gets the
 * same keyboard handling, names and error wiring without having to think about it. */

/* ---- the feel's shared helpers for floating lists (ADR-0477, plan 3.0) ----
 * Each one does nothing unless feelOn('motion'), so with the flags off, Still or reduced motion a
 * menu, popover or dialog opens exactly as it did. */

/** Sets a floating panel's transform-origin to the middle of `from` (the control that opened it), so
 * its arrival grows out of that control. The panel may already be part-way into its arrival when this
 * measures it, scaled about its own centre, so the centre is taken from the drawn box and the size
 * from the laid-out one. */
export function growFrom(panel: HTMLElement | null, from: Element | DOMRect | null) {
  if (!panel || !from || !feelOn('motion')) return;
  const rect = from instanceof Element ? from.getBoundingClientRect() : from;
  if (!rect.width && !rect.height) return;
  const drawn = panel.getBoundingClientRect();
  const left = drawn.left + drawn.width / 2 - panel.offsetWidth / 2;
  const top = drawn.top + drawn.height / 2 - panel.offsetHeight / 2;
  panel.style.transformOrigin = `${Math.round(rect.left + rect.width / 2 - left)}px ${Math.round(rect.top + rect.height / 2 - top)}px`;
}

/** The first time a list opens its items arrive one after another; later opens only grow, because
 * a menu is opened often and should answer at once (rule 1 of ADR-0477). */
export function staggerIn(list: HTMLElement | null) {
  if (!list || !feelOn('motion')) return;
  list.setAttribute('data-feel-first', '');
  [...list.children].filter((child) => !child.classList.contains(INDICATOR_CLASS))
    .forEach((child, index) => (child as HTMLElement).style.setProperty('--i', String(index)));
}

/** One highlight for a list: it slides between items under the mouse and jumps straight to an item
 * the keyboard reaches. The item under the highlight carries `data-active`, which the sliding
 * indicator follows; the list carries `data-feel-keys` while the keyboard moved it last, which
 * styles/feel-components.css reads to drop the travel. The list renders the indicator as its last
 * child (`<span className={INDICATOR_CLASS} aria-hidden="true" />`). Returns `mark`, for a list
 * whose keyboard position is held elsewhere (the combobox's active option). One listener per list,
 * never one per item. */
export function useListHighlight(listRef: RefObject<HTMLElement | null>, itemSelector: string) {
  useSlidingIndicator(listRef, '[data-active]');
  const mark = useRef<(item: Element | null, keys: boolean) => void>(() => {});
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const set = (item: Element | null, keys: boolean) => {
      for (const node of list.querySelectorAll('[data-active]')) if (node !== item) node.removeAttribute('data-active');
      if (!feelOn('motion')) {
        list.removeAttribute('data-feel-keys');
        return;
      }
      list.toggleAttribute('data-feel-keys', keys);
      if (item && !item.hasAttribute('data-active')) item.setAttribute('data-active', '');
    };
    mark.current = set;
    const itemAt = (target: EventTarget | null) => {
      const item = target instanceof Element ? target.closest(itemSelector) : null;
      return item && list.contains(item) && !item.matches(':disabled, [aria-disabled="true"]') ? item : null;
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const item = itemAt(event.target);
      if (item) set(item, false);
    };
    // the mouse leaving hands the highlight back to whatever has focus inside, or takes it away
    const leave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') set(itemAt(document.activeElement), false);
    };
    const focus = (event: FocusEvent) => set(itemAt(event.target), true);
    list.addEventListener('pointerover', over);
    list.addEventListener('pointerleave', leave);
    list.addEventListener('focusin', focus);
    return () => {
      list.removeEventListener('pointerover', over);
      list.removeEventListener('pointerleave', leave);
      list.removeEventListener('focusin', focus);
      mark.current = () => {};
    };
  }, [listRef, itemSelector]);
  return mark;
}

/** A button that shows only an icon. Its name is required, so it can never be unlabelled.
 * With the feel's depth on, its hover fill blooms out from where the mouse came in
 * (styles/feel-components.css): the entry point is written once per entry, never per move. */
export function IconButton({ icon, label, className = '', onPointerEnter, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & { icon: IconName; label: string }) {
  return (
    <button
      {...rest}
      className={`icon-button ${className}`}
      aria-label={label}
      title={rest.title ?? label}
      onPointerEnter={(event) => {
        bloomFrom(event.currentTarget, event.clientX, event.clientY, event.pointerType);
        onPointerEnter?.(event);
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Where a hover bloom starts: the point the mouse entered, in px from the button's top left. */
function bloomFrom(button: HTMLElement, x: number, y: number, pointer: string) {
  if (pointer !== 'mouse' || !feelOn('depth')) return;
  const box = button.getBoundingClientRect();
  button.style.setProperty('--bloom-x', `${Math.round(x - box.left)}px`);
  button.style.setProperty('--bloom-y', `${Math.round(y - box.top)}px`);
}

/** Subpages with real addresses: links, not tabs, so Back, reload and sharing a link all work. */
export function LinkTabs({ label, items, current }: { label: string; items: { path: string; label: string }[]; current: string }) {
  if (items.length < 2) return null;  // one tab on its own is no choice, so there are no tabs
  return <LinkTabStrip label={label} items={items} current={current} />;
}

/** The strip itself, a component of its own so the sliding indicator starts whenever the strip
 * appears, even when a page gains its second tab later. */
function LinkTabStrip({ label, items, current }: { label: string; items: { path: string; label: string }[]; current: string }) {
  const strip = useRef<HTMLElement>(null);
  useSlidingIndicator(strip, '[aria-current="page"]');
  return (
    <nav ref={strip} className="tabs" aria-label={label}>
      {items.map((item) => (
        <PageLink key={item.path} to={item.path} aria-current={current === item.path ? 'page' : undefined}>{item.label}</PageLink>
      ))}
      <span className={INDICATOR_CLASS} aria-hidden="true" />
    </nav>
  );
}

/** Tabs inside a panel, following the ARIA pattern: one tab stop, arrows move, the panel follows. */
export function Tabs<T extends string>({ label, tabs, current, onChange, children }: { label: string; tabs: { id: T; label: string }[]; current: T; onChange: (tab: T) => void; children: ReactNode }) {
  const base = useId();
  // ARIA's pattern: a panel is a tab stop of its own only when nothing inside it can take focus. A tall
  // panel full of controls as a stop would put focus on a box bigger than a phone's screen (MP-0288-06).
  const panel = useRef<HTMLDivElement>(null);
  const [panelStop, setPanelStop] = useState(true);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    const check = () => setPanelStop(!node.querySelector('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'));
    check();
    const watch = new MutationObserver(check);
    watch.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'tabindex', 'href'] });
    return () => watch.disconnect();
  }, [current]);
  // The feel (ADR-0477): one mark slides under the chosen tab, and a new panel arrives from the side
  // its tab sits on, so moving right reads as moving right.
  const strip = useRef<HTMLDivElement>(null);
  useSlidingIndicator(strip, '[aria-selected="true"]');
  const shownTab = useRef(current);
  useLayoutEffect(() => {
    const before = shownTab.current;
    shownTab.current = current;
    const node = panel.current;
    if (!node || before === current || !feelOn('motion')) return;
    const from = tabs.findIndex((tab) => tab.id === before);
    const to = tabs.findIndex((tab) => tab.id === current);
    // taking the attribute away and reading the layout restarts the arrival on the same element
    node.removeAttribute('data-feel-from');
    void node.offsetWidth;
    node.setAttribute('data-feel-from', to < from ? 'start' : 'end');
  }, [current]);
  const choose = (tab: T) => {
    if (tab !== current) tick();
    onChange(tab);
  };
  const keys = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    // Arrow keys follow the visual order in RTL as well as LTR tab lists.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === forward ? (index + 1) % tabs.length : event.key === backward ? (index + last) % tabs.length : null;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    choose(tabs[target].id);
    document.getElementById(`${base}-${tabs[target].id}`)?.focus();
  };
  return (
    <>
      <div ref={strip} className="inspector-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            role="tab"
            id={`${base}-${tab.id}`}
            aria-controls={`${base}-${tab.id}-panel`}
            aria-selected={current === tab.id}
            tabIndex={current === tab.id ? 0 : -1}
            onClick={() => choose(tab.id)}
            onKeyDown={(event) => keys(event, index)}
          >
            {tab.label}
          </button>
        ))}
        <span className={INDICATOR_CLASS} aria-hidden="true" />
      </div>
      <div ref={panel} role="tabpanel" id={`${base}-${current}-panel`} aria-labelledby={`${base}-${current}`} tabIndex={panelStop ? 0 : -1}>{children}</div>
    </>
  );
}

/** A label, the control, help and any error, joined up so a screen reader hears all of it.
 * `valid` puts a small tick beside the label once the value is right (it pops in with the feel on);
 * the tick is decoration, so whatever made the value right should still say so in words. */
export function Field({ label, help, error, valid, children, className = '' }: { label: ReactNode; help?: ReactNode; error?: string; valid?: boolean; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode; className?: string }) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const described = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}{valid && !error && <>{' '}<Icon name="check" size="compact" className="field-valid feel-pop" /></>}</label>
      {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {help && <p className="field-help" id={helpId}>{help}</p>}
      {error && <p className="warn" id={errorId} role="alert">{error}</p>}
    </div>
  );
}

/** A labelled search box with a way to clear it. Escape clears it too, and never leaves the page. */
export function SearchField({ label, value, onChange, placeholder, onEscape, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { label: string; value: string; onChange: (value: string) => void; onEscape?: () => void }) {
  const box = useRef<HTMLInputElement>(null);
  return (
    <div className="search-field">
      <Icon name="search" />
      <input
        {...rest}
        ref={box}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.stopPropagation();
            onChange('');
          } else if (event.key === 'Escape') {
            onEscape?.();
          }
          rest.onKeyDown?.(event);
        }}
      />
      {/* feel-pop: with the feel's motion on, the clear button pops in when there is something to clear */}
      {value && <IconButton icon="close" label={`Clear ${label.toLowerCase()}`} type="button" className="feel-pop" onClick={() => { onChange(''); box.current?.focus(); }} />}
    </div>
  );
}

/** A range with a spoken value, so it says "about 8 GB" rather than a bare number.
 * With the feel's motion on (ADR-0477), the slider swells while it is held and a bubble above the
 * thumb shows the value as words while the pointer drags it. The bubble is drawn outside the page's
 * layout (a fixed element in the body), so the slider's own markup and box are as they always were;
 * it is decoration, because the value is already spoken through aria-valuetext. */
export function Slider({ label, valueText, onPointerDown, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; valueText?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [held, setHeld] = useState(false);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!held) return undefined;
    const release = () => setHeld(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [held]);
  return (
    <>
      <input
        {...rest}
        ref={input}
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        // Each step the value moves is a small tick on a phone (feel/haptics, a no-op everywhere else).
        onChange={rest.onChange ? (event) => { stepTick(); rest.onChange?.(event); } : undefined}
        onInput={held ? (event) => { redraw((n) => n + 1); rest.onInput?.(event); } : rest.onInput}
        onPointerDown={(event) => {
          if (feelOn('motion') && !rest.disabled) setHeld(true);
          onPointerDown?.(event);
        }}
      />
      {held && <SliderBubble input={input} text={valueText ?? input.current?.value ?? ''} />}
    </>
  );
}

/** The value above a held slider's thumb, placed from the slider's box and its value. */
function SliderBubble({ input, text }: { input: RefObject<HTMLInputElement | null>; text: string }) {
  const bubble = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const range = input.current;
    const mark = bubble.current;
    if (!range || !mark) return;
    const box = range.getBoundingClientRect();
    const min = Number(range.min || 0);
    const max = Number(range.max || 100);
    const share = max > min ? Math.min(Math.max((range.valueAsNumber - min) / (max - min), 0), 1) : 0;
    // the thumb travels the track less its own width; about one line of text is close enough
    const thumb = Math.min(box.height, 20);
    const rtl = getComputedStyle(range).direction === 'rtl';
    const along = thumb / 2 + (box.width - thumb) * (rtl ? 1 - share : share);
    mark.style.left = `${Math.round(box.left + along)}px`;
    mark.style.top = `${Math.round(box.top)}px`;
  });
  if (typeof document === 'undefined') return null;
  return createPortal(<span ref={bubble} className="slider-bubble feel-pop" aria-hidden="true">{text}</span>, document.body);
}

/** At most one haptic tick per 40ms, so dragging fast across many steps is a texture, not a buzz. */
let lastStepTick = 0;
function stepTick() {
  const now = Date.now();
  if (now - lastStepTick < 40) return;
  lastStepTick = now;
  tick();
}

/** A small non-modal panel that opens under a button. Escape and clicking away close it, and focus
 * goes back to the button. */
export function Popover({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const shown = usePresence<HTMLDivElement>(open);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  // with the feel on, the panel grows out of the button that opened it
  useLayoutEffect(() => {
    if (open) growFrom(shown.ref.current, opener.current);
  }, [open]);
  return (
    <div
      className={`popover ${className}`}
      ref={holder}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          opener.current?.focus();
        }
      }}
    >
      <button ref={opener} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{label}</button>
      {shown.present && (
        <div
          ref={shown.ref}
          id={id}
          className="popover-panel"
          data-motion="pop"
          data-closing={shown.closing ? '' : undefined}
          aria-hidden={shown.closing || undefined}
          inert={shown.closing || undefined}
        >{children}</div>
      )}
    </div>
  );
}

/** One thing in a Menu. Its own label, and it says when it's dangerous. */
export function MenuItem({ children, danger, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return <button {...rest} role="menuitem" className={`${danger ? 'destructive' : ''} ${rest.className ?? ''}`}>{children}</button>;
}

/** Arrow keys around a grid with one tab stop, for anything laid out in rows and columns. */
export function moveInGrid(key: string, at: { row: number; column: number }, rows: number, columns: number, firstColumn = 0): { row: number; column: number } | null {
  const steps: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
  if (key === 'Home') return { row: at.row, column: firstColumn };
  if (key === 'End') return { row: at.row, column: columns - 1 };
  const step = steps[key];
  if (!step) return null;
  return {
    row: Math.min(Math.max(at.row + step[0], 0), rows - 1),
    column: Math.min(Math.max(at.column + step[1], firstColumn), columns - 1),
  };
}

/** The one class that hides something from the eye and keeps it for a screen reader. Use the
 * component, or the class name on an element that must stay what it is (a label, a heading). */
export const VISUALLY_HIDDEN = 'visually-hidden';

export function VisuallyHidden({ children, as: Tag = 'span', id }: { children: ReactNode; as?: 'span' | 'div' | 'h2' | 'h3' | 'p' | 'label'; id?: string }) {
  return <Tag id={id} className={VISUALLY_HIDDEN}>{children}</Tag>;
}
