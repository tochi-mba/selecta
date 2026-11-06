import { ButtonHTMLAttributes, cloneElement, Component, ErrorInfo, KeyboardEvent, ReactElement, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { showProblem } from './toasts';

/** A button that does something that takes time. It shows it's working from the moment it's pressed
 * until that exact thing has finished, can't be pressed twice meanwhile, and says if it went wrong. */
export function Action({
  run,
  working,
  failed,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  run: () => Promise<unknown> | unknown;
  working?: ReactNode;
  failed?: string;
}) {
  const [busy, setBusy] = useState(false);
  const going = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const press = async () => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    try {
      await run();
    } catch (error) {
      const words = (error as Error).message;
      showProblem(failed ?? (words && words !== 'Failed to fetch' ? words : 'That didn’t work. Try again.'));
    } finally {
      going.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <button {...rest} aria-busy={busy || undefined} data-working={busy || undefined} onClick={() => void press()}>
      {busy && working ? working : children}
    </button>
  );
}

export type StatusKind = 'planned' | 'queued' | 'working' | 'ready' | 'warning' | 'failed' | 'needs-action' | 'unavailable';

const STATUS: Record<StatusKind, { words: string; mark: string }> = {
  planned: { words: 'Planned', mark: '○' },
  queued: { words: 'In line', mark: '…' },
  working: { words: 'Working on it', mark: '◐' },
  ready: { words: 'Ready', mark: '✓' },
  warning: { words: 'Ready, with a warning', mark: '!' },
  failed: { words: 'Didn’t work', mark: '✕' },
  'needs-action': { words: 'Needs you', mark: '●' },
  unavailable: { words: 'Not available', mark: '–' },
};

/** The same words and the same marks everywhere, so a state never relies on colour alone. */
export function Status({ kind, children, title }: { kind: StatusKind; children?: ReactNode; title?: string }) {
  return (
    <span className={`status status-${kind}`} title={title}>
      <i aria-hidden="true">{STATUS[kind].mark}</i>
      {children ?? STATUS[kind].words}
    </span>
  );
}

export function Skeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => <i key={index} />)}
    </div>
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

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Anything that sits on top of the page: focus goes in, stays in, and returns where it was. */
function Overlay({
  title,
  onClose,
  kind,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  kind: 'dialog' | 'sheet' | 'drawer' | 'workspace';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current;
    first?.focus();
    return () => { if (before?.isConnected) before.focus(); };
  }, []);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
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
  return (
    <div className={`overlay overlay-${kind}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} className="overlay-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={keys}>
        <header className="overlay-head">
          <h2 id={titleId}>{title}</h2>
          <button className="overlay-close" aria-label={`Close ${title}`} onClick={onClose}>✕</button>
        </header>
        <div className="overlay-body">{children}</div>
        {footer && <footer className="overlay-foot">{footer}</footer>}
      </div>
    </div>
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

export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return <Overlay kind="sheet" {...props} />;
}

/** A small list of actions behind one button, usable with the keyboard. */
export function Menu({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    holder.current?.querySelector<HTMLElement>('[role="menu"] button:not([disabled])')?.focus();
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      opener.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(holder.current?.querySelectorAll<HTMLElement>('[role="menu"] button:not([disabled])') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };
  return (
    <div className={`menu ${className ?? ''}`} ref={holder} onKeyDown={keys}>
      <button ref={opener} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        // a press on anything inside closes it, because each item is the end of the job
        <div role="menu" className="menu-list" onClick={() => setOpen(false)}>{children}</div>
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
        if (event.key === 'Escape' && !dismissed) setDismissed(true);
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span role="tooltip" id={id} className="tooltip" hidden={dismissed}>{text}</span>
    </span>
  );
}

let say: (words: string) => void = () => {};

/** Tell a screen reader something once, without interrupting the music with a running commentary. */
export function announce(words: string) {
  say(words);
}

export function LiveRegion() {
  const [words, setWords] = useState('');
  useEffect(() => {
    say = (next) => {
      setWords('');
      window.setTimeout(() => setWords(next), 30);
    };
    return () => { say = () => {}; };
  }, []);
  return <div className="visually-hidden" aria-live="polite" role="status">{words}</div>;
}
