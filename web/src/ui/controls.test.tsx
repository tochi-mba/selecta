import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Action, Dialog, Menu, Problem, Section, Status, Tooltip } from './controls';
import { clearToasts, dismissToast, showProblem, showToast, Toaster } from './toasts';
import { activityEntries } from '../state/activity';

afterEach(() => clearToasts());

describe('a button that takes time', () => {
  it('shows it’s working from the moment it’s pressed until that finishes', async () => {
    let finish: () => void = () => {};
    render(<Action run={() => new Promise<void>((done) => { finish = done; })} working="Saving…">Save</Action>);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(button).toHaveTextContent('Saving…');
    expect(button).toHaveAttribute('aria-busy', 'true');
    await act(async () => finish());
    expect(button).toHaveTextContent('Save');
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('can’t be pressed twice while it’s going', () => {
    const run = vi.fn(() => new Promise<void>(() => {}));
    render(<Action run={run}>Save</Action>);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    expect(run).toHaveBeenCalledOnce();
  });

  it('only the one pressed shows it, not its neighbours', () => {
    render(<><Action run={() => new Promise<void>(() => {})}>One</Action><Action run={() => {}}>Two</Action></>);
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    expect(screen.getByRole('button', { name: 'Two' })).not.toHaveAttribute('aria-busy');
  });

  it('says what went wrong, and can be pressed again', async () => {
    render(<><Action run={async () => { throw new Error('The disk is full.'); }}>Save</Action><Toaster /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The disk is full.');
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
  });

  it('doesn’t mind the page going away before it’s finished', async () => {
    let finish: () => void = () => {};
    const { unmount } = render(<Action run={() => new Promise<void>((done) => { finish = done; })}>Save</Action>);
    fireEvent.click(screen.getByRole('button'));
    unmount();
    await act(async () => finish());
  });
});

describe('notifications', () => {
  it('a passing message can’t push out something with an Undo', () => {
    render(<Toaster />);
    act(() => {
      showToast('Moved a song.', { undo: () => {} });
      for (const word of ['One', 'Two', 'Three', 'Four', 'Five']) showToast(word);
    });
    expect(screen.getByText('Moved a song.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.queryByText('One')).toBeNull();
    expect(screen.getByText('Five')).toBeInTheDocument();
  });

  it('never shows more than a few at once', () => {
    render(<Toaster />);
    act(() => {
      for (const word of ['One', 'Two', 'Three', 'Four', 'Five']) showToast(word);
    });
    // Notifications use a portal, so count what is actually shown in the document.
    expect(document.body.querySelectorAll('.toast-row')).toHaveLength(3);
  });

  it('the same words twice is one message', () => {
    render(<Toaster />);
    act(() => {
      showToast('Saved.');
      showToast('Saved.');
    });
    expect(document.body.querySelectorAll('.toast-row')).toHaveLength(1);
  });

  it('Undo runs what that message was about', async () => {
    const undo = vi.fn(async () => {});
    render(<Toaster />);
    act(() => { showToast('Removed it.', { undo }); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undo).toHaveBeenCalledOnce());
    expect(screen.queryByText('Removed it.')).toBeNull();
  });

  it('says so if undoing fails', async () => {
    render(<Toaster />);
    act(() => { showToast('Removed it.', { undo: async () => { throw new Error('Too late.'); } }); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too late.');
  });

  it('problems are announced as problems', () => {
    render(<Toaster />);
    act(() => { showProblem('It broke.'); });
    expect(screen.getByRole('alert')).toHaveTextContent('It broke.');
  });

  it('can be dismissed', () => {
    render(<Toaster />);
    let id = 0;
    act(() => { id = showToast('Saved.'); });
    act(() => dismissToast(id));
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('go by themselves, and an Undo stays longer', () => {
    vi.useFakeTimers();
    try {
      render(<Toaster />);
      act(() => {
        showToast('Saved.');
        showToast('Moved.', { undo: () => {} });
      });
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.queryByText('Saved.')).toBeNull();
      expect(screen.getByText('Moved.')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(10000); });
      expect(screen.queryByText('Moved.')).toBeNull();
      // Expiring the toast must not erase the only way to undo the action.
      expect(activityEntries().find((entry) => entry.message === 'Moved.')?.undoState).toBe('available');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('things on top of the page', () => {
  const dialog = (onClose = vi.fn()) => (
    <>
      <button>Behind</button>
      <Dialog title="Are you sure" onClose={onClose}>
        <button>First</button>
        <button>Last</button>
      </Dialog>
    </>
  );

  it('are named, and modal', () => {
    render(dialog());
    expect(screen.getByRole('dialog', { name: 'Are you sure' })).toHaveAttribute('aria-modal', 'true');
  });

  it('Escape closes them', () => {
    const onClose = vi.fn();
    render(dialog(onClose));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('take focus, keep it inside, and give it back', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Dialog title="Hello" onClose={() => {}}><button>Only</button></Dialog>);
    expect(screen.getByRole('dialog')).toHaveFocus();
    const close = screen.getByRole('button', { name: 'Close Hello' });
    const only = screen.getByRole('button', { name: 'Only' });
    only.focus();
    fireEvent.keyDown(only, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(only).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe('a menu', () => {
  it('opens, moves with the arrow keys, and closes with Escape, back on its button', () => {
    render(<Menu label="More"><button>One</button><button>Two</button></Menu>);
    const opener = screen.getByRole('button', { name: 'More' });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'One' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'One' }), { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Two' }), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'One' })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('opens at the last action on ArrowUp and exposes the controlled menu', () => {
    render(<Menu label="More"><button>One</button><button>Two</button></Menu>);
    const opener = screen.getByRole('button', { name: 'More' });
    expect(opener).toHaveAttribute('type', 'button');
    fireEvent.keyDown(opener, { key: 'ArrowUp' });
    const menu = screen.getByRole('menu');
    expect(opener).toHaveAttribute('aria-controls', menu.id);
    expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus();
  });

  it('closes once something in it is chosen', () => {
    render(<Menu label="More"><button>One</button></Menu>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'One' }));
    expect(screen.queryByRole('button', { name: 'One' })).toBeNull();
  });
});

describe('states', () => {
  it('never rely on colour alone', () => {
    const { container } = render(<Status kind="failed" />);
    expect(container.querySelector('.status-failed svg')).toBeInTheDocument();
    expect(container).toHaveTextContent('Didn’t work');
  });

  it('a problem offers another go', async () => {
    const retry = vi.fn();
    render(<Problem retry={retry}>Couldn’t load that.</Problem>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retry).toHaveBeenCalled());
  });
});

describe('a page that breaks', () => {
  it('says so, leaves everything else alone, and can start again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    const Page = () => {
      if (broken) throw new Error('boom');
      return <p>All fine</p>;
    };
    render(<Section name="Library"><Page /></Section>);
    expect(screen.getByRole('heading', { name: 'Library stopped working.' })).toBeInTheDocument();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Start this page again' }));
    expect(screen.getByText('All fine')).toBeInTheDocument();
  });
});

describe('a tooltip', () => {
  it('describes the control to a screen reader as well', () => {
    render(<Tooltip text="Shortcut: N"><button>Jump</button></Tooltip>);
    expect(screen.getByRole('button', { name: 'Jump' })).toHaveAccessibleDescription('Shortcut: N');
  });

  it('goes away with Escape, without moving focus, and comes back next time', () => {
    render(<Tooltip text="Shortcut: N"><button>Jump</button></Tooltip>);
    const button = screen.getByRole('button', { name: 'Jump' });
    button.focus();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveAttribute('hidden');
    expect(button).toHaveFocus();
    fireEvent.blur(button);
    expect(screen.getByRole('tooltip', { hidden: true })).not.toHaveAttribute('hidden');
  });
});
