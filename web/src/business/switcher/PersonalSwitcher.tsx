// The workspace switcher as the personal Cloud pages mount it (ADR-0453 D9): CloudApp loads this
// chunk only for an account with `business.workspaces` on, so personal-only accounts never fetch
// it. Choosing an organisation opens `/b/{org}`; the switcher's own guards (offline, zone lease,
// personal music playing) apply as on business pages.

import type { Account, Api } from '../../cloud/api';
import { orgIdOf, WorkspaceSwitcher } from './WorkspaceSwitcher';
import { PATHS } from '../context';

export default function PersonalSwitcher({ api, account, open }: { api: Api; account: Account; open: (path: string) => void }) {
  return (
    <WorkspaceSwitcher api={api} userId={account.user.id} features={account.features}
      personal={{ id: account.workspace.id, name: account.workspace.name, role: account.workspace.role }}
      onSwitched={(target) => { if (target.kind !== 'personal') open(PATHS.hq(orgIdOf(target))); }} />
  );
}
