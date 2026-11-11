import { ButtonHTMLAttributes, cloneElement, Component, ErrorInfo, KeyboardEvent, ReactElement, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showProblem } from './toasts';
import { Icon, IconName } from './Icon';
export { Skeleton } from './Skeleton';

/** A button that does something that takes time. It shows it's working from the moment it's pressed
 * until that exact thing has finished, can't be pressed twice meanwhile, and says if it went wrong.
 * `waiting` is for when a neighbour's action has to finish first: unlike `disabled`, it leaves the
 * button in the tab order, so whoever pressed it isn't thrown back to the top of the page. */
export function Action({
  run,
  working,
  failed,
  waiting,
  busy: workingElsewhere,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  run: () => Promise<unknown> | unknown;
  working?: ReactNode;
  failed?: string;
  waiting?: boolean;
  /** Its work is going on somewhere else, such as a confirmation it opened (MI-0138-08). */
  busy?: boolean;
}) {
  const [pressed, setBusy] = useState(false);
  const busy = pressed || !!workingElsewhere;
  const going = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const press = async () => {
    if (going.current || waiting || workingElsewhere) return;
    going.current = true;
    setBusy(true);
    try {
      await run();
    } catch (error) {
      showProblem(failed ?? ((error as Error).message || 'That didn’t work. Try again.'));
    } finally {
      going.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <button {...rest} aria-disabled={busy || waiting || rest.disabled || undefined} aria-busy={busy || undefined} data-working={busy || undefined} onClick={() => void press()}>
      {working ? <span className="action-labels"><span aria-hidden={busy || undefined} style={{ visibility: busy ? 'hidden' : undefined }}>{children}</span><span aria-hidden={!busy || undefined} style={{ visibility: busy ? undefined : 'hidden' }}>{working}</span></span> : children}
    </button>
  );
}

export type StatusKind = 'planned' | 'queued' | 'working' | 'paused' | 'recovering' | 'ready' | 'warning' | 'blocked' | 'failed' | 'needs-action' | 'unavailable';

const STATUS: Record<StatusKind, { words: string; mark: IconName }> = {
  planned: { words: 'Planned', mark: 'circle' },
  queued: { words: 'In line', mark: 'clock' },
  working: { words: 'Working on it', mark: 'half' },
  // MP-0293-05: stopped on purpose, so it reads apart from waiting in line or never started
  paused: { words: 'Paused', mark: 'pause' },
  recovering: { words: 'Recovering', mark: 'half' },
  ready: { words: 'Ready', mark: 'check' },
  warning: { words: 'Ready, with a warning', mark: 'warning' },
  blocked: { words: 'Blocked', mark: 'warning' },
  failed: { words: 'Didn’t work', mark: 'close' },
  'needs-action': { words: 'Needs you', mark: 'dot' },
  unavailable: { words: 'Not available', mark: 'minus' },
};

/** The same words and the same marks everywhere, so a state never relies on colour alone. */
export function Status({ kind, children, title }: { kind: StatusKind; children?: ReactNode; title?: string }) {
  return (
    <span className={`status status-${kind}`} title={title}>
      <Icon name={STATUS[kind].mark} size="compact" />
      {children ?? STATUS[kind].words}
    </span>
  );
}

/** Something couldn't be loaded. That's not the same as there being nothing, so it never looks like it. */
export function Problem({ children, retry }: { children: ReactNode; retry?: () => Promise<unknown> | unknown }) {
  return (
    <div className="problem" role="alert">
      <p>{children}</p>
      {retry && <Action run={retry} working="Trying again…">Try again</Action>}
    </div>
  );
}

export class Section extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} stopped working`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page" id="main">
        <h1 className="display small">{this.props.name} stopped working.</h1>
        <p className="lede">Your music, mixes and anything playing are fine. This page just needs to start again.</p>
        <button className="primary" onClick={() => this.setState({ failed: false })}>Start this page again</button>
      </main>
    );
  }
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
let openOverlays = 0;
let previousOverflow = '';
const overlayStack: HTMLElement[] = [];

const chromeInert = new Set<Element>();
const KEPT_CHROME = '.nav, .mini';
/** Only the top overlay can be reached. Everything underneath it is inert: the page, and any overlay
 * this one opened on top of. A sheet that keeps the shell's chrome (SF-0203-06) leaves the tab bar and
 * the mini-player live: everything else in the page goes inert, one branch at a time. */
function syncInert() {
  const top = overlayStack[overlayStack.length - 1];
  const root = document.getElementById('root');
  for (const node of chromeInert) node.removeAttribute('inert');
  chromeInert.clear();
  const kept = top?.dataset.keepsChrome === 'true' && root ? [...root.querySelectorAll(KEPT_CHROME)] : [];
  if (top && kept.length && root) {
    root.removeAttribute('inert');
    const path = new Set<Element>();
    for (const node of kept) for (let at: Element | null = node; at && at !== root; at = at.parentElement) path.add(at);
    for (const branch of path) {
      if (kept.includes(branch)) continue;
      for (const sibling of branch.children) {
        if (path.has(sibling) || sibling.hasAttribute('inert')) continue;
        sibling.setAttribute('inert', '');
        chromeInert.add(sibling);
      }
    }
    for (const child of root.children) {
      if (path.has(child) || child.hasAttribute('inert')) continue;
      child.setAttribute('inert', '');
      chromeInert.add(child);
    }
  } else if (top) root?.setAttribute('inert', '');
  else root?.removeAttribute('inert');
  for (const item of overlayStack) {
    if (item === top) item.removeAttribute('inert');
    else item.setAttribute('inert', '');
  }
}

/** The tab loop must use what the browser can actually focus, not hidden disclosure content,
 * CSS-hidden actions or fields belonging to an inert subpanel. */
function canFocusInOverlay(node: HTMLElement, panel: HTMLElement | null): boolean {
  if (node.matches('input[type="hidden"]') || node.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const collapsed = node.closest('details:not([open])');
  if (collapsed && !collapsed.querySelector('summary')?.contains(node)) return false;
  for (let part: HTMLElement | null = node; part && part !== panel; part = part.parentElement) {
    const style = getComputedStyle(part);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/** Anything that sits on top of the page: focus goes in, stays in, and returns where it was, or to the
 * start of the page if what it came from has gone. */
function Overlay({
  title,
  onClose,
  kind,
  children,
  footer,
  keepsChrome,
}: {
  title: string;
  onClose: () => void;
  kind: 'dialog' | 'sheet' | 'drawer' | 'workspace';
  children: ReactNode;
  footer?: ReactNode;
  /** stops above the tab bar and mini-player and leaves them working, for a side task beside the music */
  keepsChrome?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // A list can re-render while the overlay is open and replace the button that opened it.
    // `data-focus-key` names that button stably, so focus goes back to its replacement.
    const beforeKey = before?.dataset.focusKey;
    if (openOverlays++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const mine = holder.current;
    if (mine) overlayStack.push(mine);
    syncInert();
    const first = [...(panel.current?.querySelectorAll<HTMLElement>('[data-autofocus]') ?? [])]
      .find((node) => canFocusInOverlay(node, panel.current)) ?? panel.current;
    first?.focus();
    // A control that goes away once it has done its job, like "Use what was measured" after it has,
    // would leave focus on nothing, where Escape and Tab no longer reach this overlay. Focus comes back
    // to the overlay itself instead, as it does when a notice's own button goes.
    const own = panel.current;
    const lost = new MutationObserver(() => {
      const at = document.activeElement;
      const gone = !at || at === document.body || (own?.contains(at) && (at as HTMLButtonElement).disabled);
      if (gone && own?.isConnected && overlayStack[overlayStack.length - 1] === mine) own.focus({ preventScroll: true });
    });
    // a pressed button that turns itself off while it works (Save it, then Saving...) drops focus too
    if (own) lost.observe(own, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'inert'] });
    return () => {
      lost.disconnect();
      if (--openOverlays === 0) document.body.style.overflow = previousOverflow;
      if (mine) {
        const at = overlayStack.indexOf(mine);
        if (at >= 0) overlayStack.splice(at, 1);
      }
      syncInert();
      const replacement = !before?.isConnected && beforeKey
        ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(beforeKey)}"]`)
        : null;
      if (before?.isConnected && before !== document.body) before.focus();
      else if (replacement) replacement.focus();
      else document.getElementById('content')?.focus({ preventScroll: true });
    };
  }, []);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => canFocusInOverlay(node, panel.current));
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const [first, last] = [items[0], items[items.length - 1]];
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div ref={holder} className={`overlay overlay-${kind}${keepsChrome ? ' overlay-keeps-chrome' : ''}`} data-keeps-chrome={keepsChrome ? 'true' : undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} className="overlay-panel" role="dialog" aria-modal={keepsChrome ? undefined : 'true'} aria-labelledby={titleId} tabIndex={-1} onKeyDown={keys}>
        <header className="overlay-head">
          <h2 id={titleId}>{title}</h2>
          <button className="overlay-close" aria-label={`Close ${title}`} title={`Close ${title}`} onClick={onClose}><Icon name="close" /></button>
        </header>
        <div className="overlay-body">{children}</div>
        {footer && <footer className="overlay-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <Overlay kind="dialog" {...props} />;
}

/** From the side on a wide screen, from the bottom on a phone. */
export function Drawer(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <Overlay kind="drawer" {...props} />;
}

/** Nearly the whole screen, for something that needs the room. */
export function Workspace(props: { title: string; onClose: () => void; children: ReactNode }) {
  return <Overlay kind="workspace" {...props} />;
}

export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; keepsChrome?: boolean }) {
  return <Overlay kind="sheet" {...props} />;
}

/** A small list of actions behind one button, usable with the keyboard. */
export function Menu({ label, children, className, title }: { label: ReactNode; children: ReactNode; className?: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const firstOnOpen = useRef<'first' | 'last'>('first');
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    const items = holder.current?.querySelectorAll<HTMLElement>('[role="menu"] button:not([disabled])');
    if (items?.length) items[firstOnOpen.current === 'last' ? items.length - 1 : 0].focus();
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      // Only the open menu owns Escape; a closed trigger must not prevent an
      // enclosing dialog or sheet from handling it.
      if (!open) return;
      event.stopPropagation();
      setOpen(false);
      opener.current?.focus();
      return;
    }
    if (event.key === 'Tab' && open) {
      // The focused item is about to unmount. If Tab is allowed to find the
      // next stop from a removed node, focus can fall to the document body.
      // Choose the next real stop relative to the trigger, outside this menu.
      const buttons = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((node) => (node === opener.current || !holder.current?.contains(node))
          && !node.closest('[hidden], [inert], [aria-hidden="true"]')
          && getComputedStyle(node).display !== 'none'
          && getComputedStyle(node).visibility !== 'hidden');
      const at = buttons.indexOf(opener.current!);
      const next = buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
      if (next && next !== opener.current) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        next.focus();
      } else {
        setOpen(false);
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!open) {
      event.preventDefault();
      firstOnOpen.current = event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first';
      setOpen(true);
      return;
    }
    const items = [...(holder.current?.querySelectorAll<HTMLElement>('[role="menu"] button:not([disabled])') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  return (
    <div className={`menu ${className ?? ''}`} ref={holder} onKeyDown={keys}>
      <button ref={opener} type="button" title={title} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => { firstOnOpen.current = 'first'; setOpen(!open); }}>{label}</button>
      {open && (
        // a press on anything inside closes it, because each item is the end of the job
        <div id={menuId} role="menu" className="menu-list" onClick={() => { setOpen(false); if (opener.current?.isConnected) opener.current.focus(); else document.getElementById('content')?.focus({ preventScroll: true }); }}>{children}</div>
      )}
    </div>
  );
}

/** A few words about a control, for a pointer resting on it or the keyboard reaching it. Escape
 * puts it away without moving focus, and the pointer can move onto it to read it. */
export function Tooltip({ text, children }: { text: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className="tooltip-anchor"
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !dismissed) {
          // A tooltip is the innermost dismissible UI. Do not close its parent
          // dialog on the same Escape press.
          event.stopPropagation();
          setDismissed(true);
        }
      }}
    >
      {cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], dismissed ? null : id].filter(Boolean).join(' ') || undefined,
      })}
      <span role="tooltip" id={id} className="tooltip" hidden={dismissed}>{text}</span>
    </span>
  );
}

let say: (words: string) => void = () => {};
let lastSaid = '';
let lastSaidAt = -Infinity;
const REPEAT_AFTER_MS = 8000;

/** Tell a screen reader something once, without interrupting the music with a running commentary. The
 * same words again soon after aren't news, so they aren't repeated. */
export function announce(words: string) {
  const moment = Date.now();
  if (words === lastSaid && moment - lastSaidAt < REPEAT_AFTER_MS) return;
  lastSaid = words;
  lastSaidAt = moment;
  say(words);
}

/** Outside the page, so it can still speak while a dialog has the page inert. */
export function LiveRegion() {
  const [words, setWords] = useState('');
  useEffect(() => {
    let wait: number | undefined;
    say = (next) => {
      setWords('');
      window.clearTimeout(wait);
      wait = window.setTimeout(() => setWords(next), 30);
    };
    return () => {
      window.clearTimeout(wait);
      lastSaid = '';
      say = () => {};
    };
  }, []);
  return createPortal(<div className="visually-hidden" aria-live="polite" role="status">{words}</div>, document.body);
}
