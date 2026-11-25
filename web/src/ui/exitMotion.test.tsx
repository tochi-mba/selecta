import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Menu, Tooltip } from './controls';
import { Popover } from './primitives';
import { clearToasts, dismissToast, showToast, Toaster } from './toasts';
import { motionMs, playExit } from './exitMotion';

/** The exit-animation protocol, proven both ways: with the sheets' keyframes (stood in for here by a
 * computed style that reports an animation on anything closing) and without them, as in a test
 * runner with no CSS, where everything goes at once. */

const realStyle = window.getComputedStyle.bind(window);
let animating = false;

function withKeyframes() {
  animating = true;
}

beforeEach(() => {
  animating = false;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((node: Element, pseudo?: string | null) => {
    const style = realStyle(node, pseudo);
    if (node === document.documentElement) {
      return new Proxy(style, { get: (target, key) => key === 'getPropertyValue' ? (name: string) => (name === '--motion-overlay' ? '220ms' : name === '--motion-fast' ? '120ms' : name === '--motion-handoff' ? '200ms' : target.getPropertyValue(name)) : Reflect.get(target, key) }) as CSSStyleDeclaration;
    }
    if (animating && node instanceof HTMLElement && node.hasAttribute('data-closing')) {
      return new Proxy(style, { get: (target, key) => key === 'animationName' ? 'exit' : key === 'animationDuration' ? '0.2s' : key === 'animationDelay' ? '0s' : Reflect.get(target, key) }) as CSSStyleDeclaration;
    }
    return style;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearToasts();
});

describe('the exit-animation protocol', () => {
  it('reads the motion token at the moment it is needed', () => {
    expect(motionMs('--motion-overlay')).toBe(220);
    expect(motionMs('--motion-missing', 99)).toBe(99);
  });

  it('goes at once when nothing animates', () => {
    const node = document.createElement('div');
    document.body.append(node);
    const done = vi.fn();
    playExit(node, done);
    expect(node).toHaveAttribute('data-closing');
    expect(done).toHaveBeenCalledOnce();
    node.remove();
  });

  it('waits for the animation to end, and a timeout of the token length if it never does', () => {
    vi.useFakeTimers();
    withKeyframes();
    const node = document.createElement('div');
    document.body.append(node);
    const ended = vi.fn();
    playExit(node, ended);
    expect(ended).not.toHaveBeenCalled();
    fireEvent.animationEnd(node);
    expect(ended).toHaveBeenCalledOnce();

    const stuck = vi.fn();
    playExit(node, stuck);
    vi.advanceTimersByTime(200);
    expect(stuck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(stuck).toHaveBeenCalledOnce();
    node.remove();
  });

  it('can be called off, which takes data-closing away again', () => {
    withKeyframes();
    const node = document.createElement('div');
    document.body.append(node);
    const done = vi.fn();
    const cancel = playExit(node, done);
    cancel();
    fireEvent.animationEnd(node);
    expect(done).not.toHaveBeenCalled();
    expect(node).not.toHaveAttribute('data-closing');
    node.remove();
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Dialog title="Details" onClose={() => setOpen(false)}><p>Inside</p></Dialog>}
    </>
  );
}

describe('overlays, menus, tooltips, popovers and toasts on their way out', () => {
  it('an overlay fades as an inert copy while focus is already back on the page', async () => {
    withKeyframes();
    render(<DialogHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    const ghost = document.querySelector<HTMLElement>('.overlay[data-closing]')!;
    expect(ghost).toBeTruthy();
    expect(ghost).toHaveAttribute('inert');
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(ghost.querySelector('[id]')).toBeNull();
    expect(document.getElementById('root')?.hasAttribute('inert') ?? false).toBe(false);
    fireEvent.animationEnd(ghost);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('an overlay leaves no copy at all when nothing animates', async () => {
    render(<DialogHarness />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true })); });
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('a menu stays while it fades, out of reach, then goes', () => {
    withKeyframes();
    render(<Menu label="More"><button role="menuitem">Rename</button></Menu>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const list = document.querySelector<HTMLElement>('.menu-list')!;
    expect(list).toHaveAttribute('data-motion', 'pop');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(list).toHaveAttribute('data-closing');
    expect(list).toHaveAttribute('inert');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
    act(() => { fireEvent.animationEnd(list); });
    expect(document.querySelector('.menu-list')).toBeNull();
  });

  it('a menu opened again mid-fade is simply open', () => {
    withKeyframes();
    render(<Menu label="More"><button role="menuitem">Rename</button></Menu>);
    const opener = screen.getByRole('button', { name: 'More' });
    fireEvent.click(opener);
    fireEvent.click(opener);
    fireEvent.click(opener);
    const list = screen.getByRole('menu');
    expect(list).not.toHaveAttribute('data-closing');
    expect(list).not.toHaveAttribute('inert');
  });

  it('a popover fades the same way', () => {
    withKeyframes();
    render(<Popover label="Info"><p>About this</p></Popover>);
    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    const panel = document.querySelector<HTMLElement>('.popover-panel')!;
    expect(panel).toHaveAttribute('data-motion', 'pop');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(panel).toHaveAttribute('data-closing');
    act(() => { fireEvent.animationEnd(panel); });
    expect(document.querySelector('.popover-panel')).toBeNull();
  });

  it('a tooltip put away with Escape fades, then hides', () => {
    withKeyframes();
    render(<Tooltip text="Plays next"><button>Queue</button></Tooltip>);
    const tip = screen.getByRole('tooltip', { hidden: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Queue' }), { key: 'Escape' });
    expect(tip).toHaveAttribute('data-closing');
    expect(tip).not.toHaveAttribute('hidden');
    act(() => { fireEvent.animationEnd(tip); });
    expect(tip).toHaveAttribute('hidden');
  });

  it('a dismissed toast fades in place, unreadable, then goes; the fallback catches a stuck one', () => {
    vi.useFakeTimers();
    withKeyframes();
    render(<Toaster />);
    let first = 0;
    act(() => { first = showToast('Saved.'); showToast('Copied.'); });
    act(() => dismissToast(first));
    const rows = document.querySelectorAll<HTMLElement>('.toast-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Saved.');
    expect(rows[0]).toHaveAttribute('data-closing');
    expect(rows[0]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    act(() => { fireEvent.animationEnd(rows[0]); });
    expect(screen.queryByText('Saved.')).toBeNull();

    act(() => clearToasts());
    expect(screen.getByText('Copied.').closest('.toast-row')).toHaveAttribute('data-closing');
    act(() => { vi.advanceTimersByTime(260); });
    expect(document.querySelector('.toasts')).toBeNull();
  });

  it('a toast goes at once when nothing animates', () => {
    render(<Toaster />);
    let id = 0;
    act(() => { id = showToast('Saved.'); });
    act(() => dismissToast(id));
    expect(document.querySelector('.toasts')).toBeNull();
  });
});
