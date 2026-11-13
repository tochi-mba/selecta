import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import inventory from '../../../docs/autopilot/critical-tasks.json' with { type: 'json' };
import { setFlags } from '../flags';
import { parseRoute } from '../router';
import { DashboardState, StaffCommand } from './staffApi';
import { EXPERT_FALLBACK, StaffDashboard } from './StaffDashboard';

/** ADR-0430 (AV-0430-01, -03, -04, -05) and ADR-0439 (AV-0439-01, -05): the staff dashboard's
 * states, pending versus applied, the always-visible Stop, and expert path parity. Layout at 320px
 * and 400% zoom is measured in web/e2e/apb-staff-dashboard.e2e.ts. */

const command = (over: Partial<StaffCommand>): StaffCommand => ({
  id: 'c1', kind: 'more_energy', label: 'More energy', params: {}, state: 'pending', apply_at: 'next_seam',
  seam_id: 's1', submitted_at: 1, resolved_at: null, by: 'staff', reason: '', superseded_by: null,
  words: 'More energy: waiting, changes at the next blend.', ...over,
});

const state = (over: Partial<DashboardState> = {}): DashboardState => ({
  nav: 'live', headline: 'Autopilot is playing.',
  now: { title: 'Song A', artist: 'Artist A', seconds_left: 80 }, next: { title: 'Song B', artist: 'Artist B', seconds_left: null },
  horizon: { songs: 4, minutes: 17.6, words: '4 songs planned, about 18 min.' },
  health: { level: 'ok', words: 'Everything is working.' },
  pending: [], applied: [],
  enabled: ['more_energy', 'less_energy', 'hold_genre', 'skip_next', 'extend_current', 'pause', 'hand_to_manual'],
  stop: { visible: true, enabled: true }, announcement: '', expert_controls: EXPERT_FALLBACK, ...over,
});

afterEach(() => setFlags(null));

describe('staff dashboard', () => {
  it('is gone when its flag is off', () => {
    setFlags({ 'venue.staff_dashboard': false });
    const { container } = render(<StaffDashboard state={state()} onCommand={() => {}} onStop={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows now, next, plan and health at a glance', () => {
    render(<StaffDashboard state={state()} onCommand={() => {}} onStop={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Staff dashboard' })).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Now playing' })).getByText('Song A')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Next' })).getByText('Song B')).toBeInTheDocument();
    expect(screen.getByText('4 songs planned, about 18 min.')).toBeInTheDocument();
    expect(screen.getByText('Everything is working.')).toBeInTheDocument();
  });

  it.each(['loading', 'setting_up', 'live', 'paused', 'manual', 'offline', 'failed', 'stopped'] as const)(
    'keeps Stop visible and expert controls listed when %s', (nav) => {
      const shown = nav === 'loading' ? null : state({ nav, enabled: [], stop: { visible: true, enabled: nav !== 'stopped' } });
      render(<StaffDashboard state={shown} onCommand={() => {}} onStop={() => {}} />);
      const stop = screen.getByRole('button', { name: nav === 'stopped' ? 'Stopped' : 'Stop' });
      expect(stop).toBeVisible();
      if (nav === 'stopped') expect(stop).toBeDisabled(); else expect(stop).toBeEnabled();
      const expert = screen.getByRole('navigation', { name: 'Expert controls' });
      expect(within(expert).getAllByRole('link')).toHaveLength(inventory.expert_controls.length);
      expect(document.querySelector('.staff-dashboard')?.getAttribute('data-nav')).toBe(nav);
    });

  it('steers by keyboard and only with the commands the state allows', async () => {
    const onCommand = vi.fn();
    const user = userEvent.setup();
    render(<StaffDashboard state={state({ enabled: ['more_energy', 'pause'] })} onCommand={onCommand} onStop={() => {}} genres={['House']} />);
    expect(screen.getByRole('button', { name: 'Skip next' })).toBeDisabled();
    screen.getByRole('button', { name: 'More energy' }).focus();
    await user.keyboard('{Enter}');
    expect(onCommand).toHaveBeenCalledWith('more_energy');
    expect(screen.getByRole('button', { name: 'Hold genre' })).toBeDisabled();
  });

  it('sends the chosen genre with Hold genre', async () => {
    const onCommand = vi.fn();
    const user = userEvent.setup();
    render(<StaffDashboard state={state()} onCommand={onCommand} onStop={() => {}} genres={['House', 'Disco']} />);
    await user.selectOptions(screen.getByLabelText('Genre to hold'), 'Disco');
    await user.click(screen.getByRole('button', { name: 'Hold genre' }));
    expect(onCommand).toHaveBeenCalledWith('hold_genre', { genre: 'Disco' });
  });

  it('separates waiting from done and announces politely', () => {
    const waiting = command({});
    const done = command({ id: 'c2', kind: 'skip_next', label: 'Skip next', state: 'applied', words: 'Skip next: done.' });
    const { rerender } = render(<StaffDashboard state={state({ pending: [waiting], announcement: waiting.words })} onCommand={() => {}} onStop={() => {}} />);
    const live = screen.getByTestId('staff-announcement');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveTextContent('waiting, changes at the next blend');
    expect(within(screen.getByTestId('staff-pending')).getByText('Waiting')).toBeInTheDocument();
    rerender(<StaffDashboard state={state({ applied: [done], announcement: done.words })} onCommand={() => {}} onStop={() => {}} />);
    expect(screen.queryByTestId('staff-pending')).toBeNull();
    expect(within(screen.getByTestId('staff-applied')).getByText('Done')).toBeInTheDocument();
    expect(live).toHaveTextContent('Skip next: done.');
  });

  it('rehearses emergency Stop from the keyboard; Stop is the first button', async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<StaffDashboard state={state()} onCommand={() => {}} onStop={onStop} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('ADR-0439 inventory and expert path parity', () => {
  it('covers every mode with keyboard-reachable tasks at 320px', () => {
    expect(inventory.modes.map((mode) => mode.id).sort()).toEqual(['cloud', 'guest', 'local', 'room_host', 'venue_staff']);
    for (const mode of inventory.modes) for (const task of mode.tasks) {
      expect(task.keyboard.length).toBeGreaterThan(0);
      expect(task.min_width_px).toBeLessThanOrEqual(320);
    }
  });

  it('keeps every expert control a real page with the dashboard flag on', () => {
    setFlags({ 'venue.staff_dashboard': true, 'autopilot.venue_mode': true });
    expect(EXPERT_FALLBACK).toEqual(inventory.expert_controls);
    render(<StaffDashboard state={state()} onCommand={() => {}} onStop={() => {}} />);
    const expert = screen.getByRole('navigation', { name: 'Expert controls' });
    for (const control of inventory.expert_controls) {
      expect(parseRoute(control.path).page).not.toBe('missing');
      expect(within(expert).getByRole('link', { name: control.label })).toHaveAttribute('href', control.path);
    }
  });

  it('respects reduced motion, contrast and forced colours in its stylesheet', () => {
    const css = readFileSync(resolve(__dirname, 'staffDashboard.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(css).toMatch(/@media \(prefers-contrast: more\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    const motionBlock = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(css.replace(motionBlock, '')).not.toMatch(/transition|animation/);
    expect(css).toMatch(/minmax\(min\(100%/);
  });
});
