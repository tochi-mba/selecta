import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './controls';

// SF-0203-06 (ADR-0203): a sheet that keeps the shell's chrome leaves the tab bar and the mini-player
// reachable, so Tab must be able to leave the sheet for them instead of wrapping inside it.
function page(onClose: () => void) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return render(
    <>
      <nav className="nav"><a href="/library">Library</a></nav>
      <main><button>On the page</button></main>
      <aside className="mini"><button>Pause</button></aside>
      <Sheet title="Transition" onClose={onClose} keepsChrome><button>Last in the sheet</button></Sheet>
    </>,
    { container: root },
  );
}

describe('a sheet that keeps the tab bar and mini-player', () => {
  it('lets Tab and Shift+Tab leave it for the chrome, and still closes on Escape', () => {
    const onClose = vi.fn();
    const view = page(onClose);
    const close = screen.getByRole('button', { name: 'Close Transition' });
    const last = screen.getByRole('button', { name: 'Last in the sheet' });
    expect(screen.getByText('On the page').closest('main')).toHaveAttribute('inert');
    expect(screen.getByText('Pause').closest('[inert]')).toBeNull();

    last.focus();
    // not cancelled: the browser moves on to the chrome, rather than wrapping to the close button
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(last);
    close.focus();
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    document.getElementById('root')?.remove();
  });
});
