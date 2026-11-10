import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Action } from './controls';
import { ActivityPanel } from './ActivityPanel';
import { ControlGallery } from './ControlGallery';
import { Field, LinkTabs, Tabs } from './primitives';
import { clearToasts, showToast, Toaster } from './toasts';
import { activityEntries, clearActivity } from '../state/activity';
import { reloadPrefs } from '../state/prefs';
import { useReducedMotion } from './useReducedMotion';

/** UI/UX polish programme (ADR-0035, ADR-0044): shared control inventory, stable busy geometry,
 * labelled fields, tab relationships, Undo under notification bursts and live reduced motion. */

afterEach(() => {
  act(() => clearToasts());
  act(() => clearActivity());
  vi.unstubAllGlobals();
});

describe('P0021 development gallery inventory', () => {
  it('holds every shared control family the polish inventory names', () => {
    const { container } = render(<ControlGallery />);
    const gallery = container.querySelector('details.control-gallery')!;
    expect(gallery.querySelector('summary')).toHaveTextContent('Development component gallery');
    const has = (selector: string) => expect(gallery.querySelector(selector), selector).not.toBeNull();
    has('button.primary');                                  // buttons
    has('button[aria-label="Example icon action"] svg');    // icon buttons
    has('a[href]');                                         // links
    has('input[type="search"]');                            // inputs
    has('select');                                          // selects
    has('input[type="range"]');                             // sliders
    has('.chips button[aria-pressed="true"]');              // chips
    has('[role="tablist"] [role="tab"]');                   // tabs
    has('.pill');                                           // badges
    has('.song-row');                                       // rows
    has('article.card .card-actions button');              // cards
    has('[aria-haspopup], button[aria-expanded]');         // menus
    has('.status');                                         // status badges
    has('button.destructive');                              // destructive (S31-0079-06)
    expect(within(gallery as HTMLElement).getAllByText(/Tooltip/).length).toBeGreaterThan(0);
    expect(within(gallery as HTMLElement).getByRole('button', { name: 'Open dialog', hidden: true })).toBeInTheDocument();
    expect(within(gallery as HTMLElement).getByRole('button', { name: 'Open drawer', hidden: true })).toBeInTheDocument();
  });

  it('is only mounted in development or an explicit gallery test build', () => {
    const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
    const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
    const workshop = fs.readFileSync(`${node.cwd()}/src/views/Workshop.tsx`, 'utf8');
    expect(workshop).toMatch(/\(import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_SELECTA_GALLERY === '1'\) && tab === 'diagnostics' && <ControlGallery \/>/);
  });
});

describe('P0023 busy actions keep their geometry', () => {
  it('reserves both labels in one slot, so the width never changes, and refuses a second press', () => {
    let finish: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((done) => { finish = done; }));
    render(<Action run={run} working="Saving this longer label…">Save</Action>);
    const button = screen.getByRole('button');
    const labels = button.querySelectorAll('.action-labels > span');
    expect(labels).toHaveLength(2);
    expect((labels[1] as HTMLElement).style.visibility).toBe('hidden');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(run).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect((labels[0] as HTMLElement).style.visibility).toBe('hidden');
    expect(labels[0]).toHaveAttribute('aria-hidden', 'true');
    expect((labels[1] as HTMLElement).style.visibility).toBe('');
    act(() => finish());
  });
});

describe('P0024 fields keep a persistent label, help and inline error', () => {
  it('joins label, help and error to the control without relying on the placeholder', () => {
    render(<Field label="Minutes" help="A whole number of minutes." error="Choose a value between 1 and 10.">{(field) => <input {...field} placeholder="5" />}</Field>);
    const input = screen.getByRole('textbox', { name: 'Minutes' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('A whole number of minutes. Choose a value between 1 and 10.');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a value between 1 and 10.');
    fireEvent.change(input, { target: { value: '12' } });
    expect(screen.getByText('Minutes').tagName).toBe('LABEL');
  });
});

function TabProbe() {
  const [tab, setTab] = useState<'listen' | 'change' | 'details'>('listen');
  return <Tabs label="This transition" tabs={[{ id: 'listen', label: 'Listen' }, { id: 'change', label: 'Change' }, { id: 'details', label: 'Details' }]} current={tab} onChange={setTab}><p>Panel for {tab}</p></Tabs>;
}

describe('P0025 inspector tabs and route links', () => {
  it('has one tab stop, arrow/Home/End selection that moves focus, and a panel labelled by its tab', () => {
    render(<TabProbe />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    const panel = screen.getByRole('tabpanel');
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0].id);
    expect(panel).toHaveAccessibleName('Listen');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Details' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Listen' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel for change');
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('draws subpages with real addresses as links marked current, never as tabs', () => {
    render(<LinkTabs label="Workspace" current="/workshop/storage" items={[{ path: '/workshop', label: 'Overview' }, { path: '/workshop/storage', label: 'Storage' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).queryByRole('tab')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Storage' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });
});

describe('P0028 every Undo survives a notification burst', () => {
  it('five Undo messages: three on screen, all five still undoable from Activity', async () => {
    render(<><Toaster /><ActivityPanel /></>);
    const undone: string[] = [];
    act(() => {
      for (const name of ['first', 'second', 'third', 'fourth', 'fifth']) showToast(`Removed the ${name} song.`, { undo: () => { undone.push(name); } });
    });
    expect(document.querySelectorAll('.toast-row')).toHaveLength(3);
    expect(activityEntries().filter((entry) => entry.undoState === 'available')).toHaveLength(5);
    const first = screen.getByRole('button', { name: 'Undo: Removed the first song.' });
    expect(screen.getAllByRole('button', { name: /^Undo: / })).toHaveLength(5);
    await act(async () => { fireEvent.click(first); });
    expect(undone).toEqual(['first']);
  });
});

describe('P0119 reduced motion follows a preference change while the app is open', () => {
  beforeEach(() => { localStorage.clear(); reloadPrefs(); });

  it('switches to still the moment the operating system asks, and back', () => {
    let listener: () => void = () => {};
    const media = { matches: false, addEventListener: vi.fn((_: string, fn: () => void) => { listener = fn; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    function Probe() { return <span>{useReducedMotion() ? 'Still' : 'Animated'}</span>; }
    render(<Probe />);
    expect(screen.getByText('Animated')).toBeInTheDocument();
    act(() => { media.matches = true; listener(); });
    expect(screen.getByText('Still')).toBeInTheDocument();
    act(() => { media.matches = false; listener(); });
    expect(screen.getByText('Animated')).toBeInTheDocument();
  });
});

describe('P0117 explanations separate automated checks from human judgement', () => {
  it('says audio checks cannot judge sound, and a chord match is a suggestion to check by ear', () => {
    const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
    const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
    const read = (file: string) => fs.readFileSync(`${node.cwd()}/src/${file}`, 'utf8');
    expect(read('views/WorkshopPanels.tsx')).toContain('are automatic checks on the audio. They can’t say how something sounds.');
    expect(read('views/Links.tsx')).toContain('Chord match, a suggestion to check by ear, not a verified match');
  });
});
