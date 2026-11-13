import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../cloud/api';
import { ZoneSwitcher } from './staff/ZoneSwitcher';
import { WorkspaceSwitcher } from './switcher/WorkspaceSwitcher';

// The business switcher reads its workspace list from the store. Keep the real Menu controls
// and their keyboard/selection wiring under test, independent of account network state.
vi.mock('./useWorkspaces', () => ({
  useWorkspaces: () => {
    const personal = { id: 'personal', kind: 'personal', name: 'Personal', role: 'owner' };
    const business = { id: 'venue-ws', kind: 'business', name: 'The Crown', role: 'venue_manager' };
    return {
      enabled: true, loading: false, error: '',
      workspaces: [personal, business], current: personal,
      store: { getState: () => ({ online: true }) },
      setDevice: () => {},
      switchTo: (id: string) => ({ ok: true, workspace: id === business.id ? business : personal }),
    };
  },
}));
vi.mock('./client', () => ({ businessClient: () => ({ workspaces: async () => [] }) }));

describe('business menu coverage (S4-0094-10)', () => {
  it('opens the zone menu for five zones and changes the selected zone', () => {
    const onChange = vi.fn();
    const zones = Array.from({ length: 5 }, (_, index) => ({
      id: `zone-${index + 1}`, venue_id: 'venue', name: `Zone ${index + 1}`,
      state: 'playing' as const, paid: true,
    }));
    render(<ZoneSwitcher zones={zones} current="zone-1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /zone/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zone 2' }));
    expect(onChange).toHaveBeenCalledWith('zone-2');
  });

  it('opens the workspace menu and changes from personal to business', () => {
    const onSwitched = vi.fn();
    render(
      <WorkspaceSwitcher api={vi.fn() as unknown as Api} userId="person-1"
        personal={{ id: 'personal', name: 'Personal' }}
        features={{ 'business.workspaces': true }} onSwitched={onSwitched} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /personal/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /The Crown/i }));
    expect(onSwitched).toHaveBeenCalledWith(expect.objectContaining({ id: 'venue-ws' }));
  });
});
