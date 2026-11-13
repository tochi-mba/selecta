// The business shell's frame (ADR-0453 D2, D5, D9): the WorkspaceBand with the switcher on top of
// every page, the navigation (a rail on desktop, a tab bar on phones, the same nav element so
// keyboard order and landmarks never change), and the page in <main>. Staff get no navigation:
// their whole app is S4. Wall mode (`?wall=1` on HQ) hides the navigation for an operations room.

import type { MouseEvent, ReactNode } from 'react';
import type { Account, Api } from '../../cloud/api';
import { Status } from '../../ui/controls';
import { PilotBadge } from '../components/Notices';
import type { BusinessRoute } from '../context';
import { SHELL_COPY } from '../copy/shell';
import type { Org } from '../types';
import { WorkspaceBand } from '../switcher/WorkspaceBand';
import { orgIdOf, WorkspaceSwitcher, type SwitcherDevice } from '../switcher/WorkspaceSwitcher';
import { PATHS } from '../context';
import { navIdOf, navItems } from './nav';
import './shell.css';

export function BusinessShell({ org, route, api, account, now, readOnly, offline, wall, device, go, onLeaveToPersonal, children }: {
  org: Org;
  route: BusinessRoute;
  api: Api;
  account: Account;
  now: number;
  readOnly: boolean;
  offline: boolean;
  wall?: boolean;
  device?: SwitcherDevice;
  go: (path: string) => void;
  onLeaveToPersonal: () => void;
  children: ReactNode;
}) {
  const items = wall ? [] : navItems(org);
  const current = navIdOf(route);
  const follow = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    go(path);
  };
  return (
    <div className={`biz biz-shell${items.length ? '' : ' biz-shell-bare'}`} data-role={org.role}>
      <header className="biz-shell-top">
        <WorkspaceBand kind="business" name={org.name} role={org.role}
          marks={<>{org.pilot && <PilotBadge pilot={org.pilot} now={now} />}{readOnly && <Status kind="unavailable">{SHELL_COPY.readOnly}</Status>}</>}>
          <WorkspaceSwitcher api={api} userId={account.user.id} features={account.features} device={device} online={offline ? false : undefined}
            personal={{ id: account.workspace.id, name: account.workspace.name, role: account.workspace.role }}
            onSwitched={(target) => (target.kind === 'personal' ? onLeaveToPersonal() : go(PATHS.hq(orgIdOf(target))))} />
        </WorkspaceBand>
      </header>
      {items.length > 0 && (
        <nav className="biz-shell-nav" aria-label={SHELL_COPY.navLabel}>
          <span className="biz-shell-brand" aria-hidden="true"><span className="cloud-mark">S</span>{SHELL_COPY.brand}</span>
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <a href={item.path} aria-current={current === item.id ? 'page' : undefined} onClick={(event) => follow(event, item.path)}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main className="biz-shell-main" id="biz-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
