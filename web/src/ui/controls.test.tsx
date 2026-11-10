import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Action, Dialog, Menu, Problem, Section, Status, Tooltip } from './controls';
import { clearToasts, dismissToast, showProblem, showToast, Toaster } from './toasts';
import { activityEntries, blockedBy, canUndo, clearFinishedActivity, markNewestUndone, recordActivity, runUndo } from '../state/activity';

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

describe('scope-safe Undo history', () => {
  it('keeps older Undo blocked while the newer one runs and after it fails', async () => {
    const oldest = recordActivity('First edit', { scope: 'current', undo: async () => {} });
    let rejectNewer: (error: Error) => void = () => {};
    const newest = recordActivity('Second edit', {
      scope: 'current',
      undo: () => new Promise<void>((_resolve, reject) => { rejectNewer = reject; }),
    });
    const pending = runUndo(newest);
    expect(canUndo(oldest)).toBe(false);
    expect(blockedBy(activityEntries().find((entry) => entry.id === oldest)! )?.id).toBe(newest);
    rejectNewer(new Error('The connection dropped.'));
    await expect(pending).rejects.toThrow('The connection dropped.');
    expect(canUndo(oldest)).toBe(false);
    clearFinishedActivity();
    expect(canUndo(oldest)).toBe(false);
    await expect(runUndo(oldest)).rejects.toThrow(/newer Undo failed/);
    // Only an independently confirmed, successful Undo elsewhere can release this guard.
    markNewestUndone('current');
    expect(canUndo(oldest)).toBe(true);
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
  it('give focus to the opener’s replacement when a re-render swapped the opener out', () => {
    // A Library correction reloads the list while the sheet is open, replacing the row's button.
    const opener = document.createElement('button');
    opener.dataset.focusKey = 'song-details-7';
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Dialog title="Song" onClose={() => {}}><button>Only</button></Dialog>);
    opener.remove();
    const replacement = document.createElement('button');
    replacement.dataset.focusKey = 'song-details-7';
    document.body.append(replacement);
    unmount();
    expect(replacement).toHaveFocus();
    replacement.remove();
  });
  it('makes the parent inert during a nested dialog and restores the nested opener', () => {
    function Nested() {
      const [inner, setInner] = useState(false);
      return <Dialog title="Parent" onClose={() => {}}>
        <button onClick={() => setInner(true)}>Open child</button>
        {inner && <Dialog title="Child" onClose={() => setInner(false)}><button>Child action</button></Dialog>}
      </Dialog>;
    }
    render(<Nested />);
    const parent = screen.getByRole('dialog', { name: 'Parent' });
    const opener = screen.getByRole('button', { name: 'Open child' });
    // fireEvent.click does not perform the browser's normal pointer focus step.
    // Model it explicitly so nested-dialog restoration checks the real opener.
    opener.focus();
    fireEvent.click(opener);
    expect(parent.closest('.overlay')).toHaveAttribute('inert');
    const child = screen.getByRole('dialog', { name: 'Child' });
    expect(child.closest('.overlay')).not.toHaveAttribute('inert');
    fireEvent.keyDown(child, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Child' })).toBeNull();
    expect(parent.closest('.overlay')).not.toHaveAttribute('inert');
    expect(opener).toHaveFocus();
  });

  it('treats a disclosure summary as the last Tab stop and skips collapsed contents', () => {
    render(<Dialog title="Options" onClose={() => {}}>
      <button>Visible action</button>
      <button style={{ display: 'none' }}>CSS hidden action</button>
      <details><summary>Advanced options</summary><button>Collapsed action</button></details>
    </Dialog>);
    const close = screen.getByRole('button', { name: 'Close Options' });
    const summary = screen.getByText('Advanced options');
    summary.focus();
    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(summary).toHaveFocus();
  });

  it('does not autofocus a CSS-hidden or hidden control', () => {
    render(<Dialog title="Focus choice" onClose={() => {}}>
      <button data-autofocus style={{ display: 'none' }}>CSS hidden</button>
      <button data-autofocus hidden>Hidden</button>
      <button data-autofocus>Ready</button>
    </Dialog>);
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveFocus();
  });

  it('keep focus when a control in them goes away once it has done its job, so Escape still closes them', async () => {
    const onClose = vi.fn();
    function PutBack() {
      const [corrected, setCorrected] = useState(true);
      return (
        <Dialog title="Paper Moon" onClose={onClose}>
          <p>Tempo {corrected ? '238' : '119'}</p>
          {corrected && <button onClick={() => setCorrected(false)}>Use what was measured</button>}
        </Dialog>
      );
    }
    render(<PutBack />);
    const putBack = screen.getByRole('button', { name: 'Use what was measured' });
    putBack.focus();
    fireEvent.click(putBack);
    expect(screen.queryByRole('button', { name: 'Use what was measured' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Paper Moon' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('menu Tab continuity', () => {
  it('moves forward to the following control when the selected item disappears', () => {
    render(<><button>Before</button><Menu label="More"><button>One</button><button>Two</button></Menu><button>After</button></>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const item = screen.getByRole('button', { name: 'One' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'One' })).toBeNull();
  });
  it('moves back to the preceding control on Shift+Tab', () => {
    render(<><button>Before</button><Menu label="More"><button>One</button></Menu><button>After</button></>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const item = screen.getByRole('button', { name: 'One' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
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

  it('does not swallow a dialog Escape when its menu is closed', () => {
    const onClose = vi.fn();
    render(<Dialog title="Settings" onClose={onClose}><Menu label="More"><button>Something</button></Menu></Dialog>);
    const menu = screen.getByRole('button', { name: 'More' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
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

  it('dismisses only the tooltip on the first Escape inside a dialog', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Details" onClose={onClose}>
        <Tooltip text="Shortcut: N"><button>Jump</button></Tooltip>
      </Dialog>,
    );
    const jump = screen.getByRole('button', { name: 'Jump' });
    jump.focus();
    fireEvent.keyDown(jump, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveAttribute('hidden');
    expect(jump).toHaveFocus();
    fireEvent.keyDown(jump, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('preserves an existing accessible description on the wrapped control', () => {
    render(<>
      <p id="context-note">Second action is optional.</p>
      <Tooltip text="Shortcut: N"><button aria-describedby="context-note">Jump</button></Tooltip>
    </>);
    expect(screen.getByRole('button', { name: 'Jump' }))
      .toHaveAccessibleDescription('Second action is optional. Shortcut: N');
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

describe('Undo confirmation timing', () => {
  it('retains the exact Undo notification while the server is still responding', async () => {
    let finish: () => void = () => {};
    const undo = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<Toaster />);
    act(() => { showToast('Moved song three.', { undo }); });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.getByText('Moved song three.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undoing…' })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { finish(); });
    expect(screen.queryByText('Moved song three.')).toBeNull();
  });
});

describe('toast focus continuity', () => {
  it('restores focus to the active page after a confirmed Undo removes its button', async () => {
    const main = document.createElement('div');
    main.id = 'content';
    main.tabIndex = -1;
    document.body.append(main);
    try {
      render(<Toaster />);
      act(() => { showToast('Undo this change.', { undo: async () => {} }); });
      const undo = screen.getByRole('button', { name: 'Undo' });
      undo.focus();
      fireEvent.click(undo);
      await waitFor(() => expect(screen.queryByText('Undo this change.')).toBeNull());
      expect(main).toHaveFocus();
    } finally {
      main.remove();
    }
  });
});
