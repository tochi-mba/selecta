import { ReactNode, useId, useLayoutEffect, useRef } from 'react';
import { Icon } from '../ui/Icon';

/** A native modal dialog. The browser keeps focus inside it and makes the page behind it inert;
 * Escape closes it, and focus goes back to whatever opened it. */
export function NativeDialog({ title, onClose, children, footer, className = '' }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    const before = document.activeElement as HTMLElement | null;
    try {
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>('.overlay-close'))?.focus();
    return () => {
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
      } catch {
        /* already closed */
      }
      if (before?.isConnected && before !== document.body) before.focus({ preventScroll: true });
      else document.getElementById('content')?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={box}
      className={`lucy-dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onKeyDown={(event) => {
        // the app's own Escape handling mustn't also act on this
        if (event.key === 'Escape') event.stopPropagation();
      }}
    >
      <header className="overlay-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="overlay-close" aria-label={`Close ${title}`} title={`Close ${title}`} onClick={() => closeRef.current()}><Icon name="close" /></button>
      </header>
      <div className="overlay-body">{children}</div>
      {footer && <footer className="overlay-foot">{footer}</footer>}
    </dialog>
  );
}
