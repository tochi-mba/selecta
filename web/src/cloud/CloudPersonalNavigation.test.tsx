import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DESTINATIONS } from '../shell/manifest';
import {
  CLOUD_PERSONAL_DESTINATIONS, CloudPersonalNavigation, PERSONAL_PAGE,
  PRIMARY_PERSONAL_DESTINATIONS, personalDestination, personalTitle,
} from './CloudPersonalNavigation';
import { resolveRoute } from './cloudRoutes';

describe('browser-first Cloud parity navigation', () => {
  it('reuses the same primary names, icons and local deep links', () => {
    expect(PRIMARY_PERSONAL_DESTINATIONS.map(({ id, label, icon, path }) =>
      ({ id, label, icon, path }))).toEqual(
      DESTINATIONS.map(({ id, label, icon, path }) => ({ id, label, icon, path })),
    );
    expect(PRIMARY_PERSONAL_DESTINATIONS.map((item) => item.label)).toEqual(
      ['Listen', 'Make a Mix', 'My Mixes', 'Library', 'Workspace'],
    );
  });

  it.each([
    ['/', 'home', 'home'],
    ['/listen', 'listen', 'listen'],
    ['/player', 'listen', 'listen'],
    ['/mixes', 'explore', 'listen'],
    ['/discover', 'explore', 'listen'],
    ['/mixes/mine', 'mine', 'listen'],
    ['/studio', 'studio', 'listen'],
    ['/library', 'library', 'library'],
    ['/workshop', 'workspace', 'home'],
    ['/upload', 'connect', 'uploads'],
    ['/devices', 'devices', 'settings'],
    ['/rooms', 'rooms', 'listen'],
    ['/account', 'settings', 'settings'],
    ['/account/billing', 'billing', 'billing'],
  ] as const)('preserves %s as a distinct destination and valid Cloud route', (path, destination, page) => {
    expect(personalDestination(path)).toBe(destination);
    expect(PERSONAL_PAGE[destination]).toBe(page);
    expect(resolveRoute(path)).toEqual({ kind: 'page', page });
  });

  it('does not treat unknown routes or path fragments as a valid local destination', () => {
    expect(personalDestination('/account/private')).toBe(null);
    expect(personalDestination('/listening')).toBe(null);
    expect(personalDestination('/mixes/mine/extra')).toBe(null);
    expect(personalTitle('mine')).toBe('My Mixes');
  });

  it('keeps local music actions primary and Cloud-specific controls in More', async () => {
    const go = vi.fn();
    const user = userEvent.setup();
    render(<nav aria-label="Cloud workspace"><CloudPersonalNavigation
      active="mine" go={go} roomsAvailable={false} /></nav>);
    const navigation = screen.getByRole('navigation', { name: 'Cloud workspace' });
    expect(within(navigation).getByRole('button', { name: 'My Mixes' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(navigation).getByRole('button', { name: 'Make a Mix' }));
    expect(go).toHaveBeenCalledWith('/mixes');
    await user.click(within(navigation).getByText('Cloud & account'));
    expect(within(navigation).getByRole('button', { name: 'Workspace' })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: 'Plan & billing' })).toBeInTheDocument();
    expect(within(navigation).queryByRole('button', { name: 'Rooms' })).toBeNull();
    expect(CLOUD_PERSONAL_DESTINATIONS.some((item) => item.path === '/rooms')).toBe(true);
  });
});
