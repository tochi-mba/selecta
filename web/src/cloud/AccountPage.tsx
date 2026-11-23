import { Fragment, ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Badge, SETTINGS_ANCHORS, SettingsGroup, SettingsLayout, SettingsPlace } from './AccountLayout';

// The Account page: who is signed in, then each kind of setting as a named group of cards, in the
// order of the section list beside them. What goes in each group is decided where the account and
// its flags are known (CloudApp); a group with nothing in it is left out, so the page reflows.

/** Who is signed in: an initial, the address, the plan, and the way to sign out. */
export function AccountStrip({ email, plan, workspace, onSignOut, onStaffConsole, onPlan }: {
  email: string;
  /** the plan's name, shown as a badge; left out where the frame already says it */
  plan?: string;
  workspace?: string;
  onSignOut: () => void;
  onStaffConsole?: () => void;
  /** opens Plan & billing */
  onPlan?: () => void;
}) {
  return (
    <section className="acct-card cloud-account-strip" aria-label="Signed in as">
      <div className="acct-profile">
        <span className="acct-avatar" aria-hidden="true">{email.trim()[0] ?? '?'}</span>
        <div className="acct-profile-text">
          <p className="acct-profile-email cloud-account-email"><span className="visually-hidden">Signed in as </span>{email}</p>
          <div className="acct-profile-facts">
            {plan && <Badge>{plan} plan</Badge>}
            {workspace && <span>{workspace}</span>}
          </div>
        </div>
        <div className="acct-profile-actions">
          {onStaffConsole && <button type="button" className="quiet" onClick={onStaffConsole}>Staff console</button>}
          {onPlan && <button type="button" className="quiet" onClick={onPlan}>Manage plan</button>}
          <button type="button" onClick={onSignOut}><Icon name="signout" size="toolbar" />Sign out</button>
        </div>
      </div>
    </section>
  );
}

/** Drops the empty slots (`false`, `null`), so a group whose every card is off is not drawn. */
function some(nodes: ReactNode[] | undefined) {
  // keyed by its place in the list, so a card keeps its state when a neighbour comes or goes
  const kept = (nodes ?? []).map((node, place) => (node === false || node === null || node === undefined ? null : <Fragment key={place}>{node}</Fragment>)).filter(Boolean);
  return kept.length ? kept : null;
}

export function AccountPage({ places, profile, lucy, data, advanced, danger }: {
  /** the section list; left out in a frame that has no settings pages */
  places?: SettingsPlace[];
  profile: ReactNode[];
  lucy?: ReactNode[];
  data: ReactNode[];
  advanced?: ReactNode[];
  danger?: ReactNode[];
}) {
  const lucyCards = some(lucy);
  const advancedCards = some(advanced);
  const dangerCards = some(danger);
  return (
    <SettingsLayout current="profile" places={places}>
      <SettingsGroup id={SETTINGS_ANCHORS.profile} title="Profile" about="Who is signed in on this device.">{some(profile)}</SettingsGroup>
      {lucyCards && <SettingsGroup id={SETTINGS_ANCHORS.lucy} title="Lucy" about="Your AI mixing assistant: when it helps, and what it may see.">{lucyCards}</SettingsGroup>}
      <SettingsGroup id={SETTINGS_ANCHORS.data} title="Data & privacy" about="Take a copy of what SelectaDJ keeps for you, and see what stays on this device.">{some(data)}</SettingsGroup>
      {advancedCards && <SettingsGroup id={SETTINGS_ANCHORS.advanced} title="Advanced" about="Previews and checks. Most people never need these.">{advancedCards}</SettingsGroup>}
      {dangerCards && <SettingsGroup id="settings-danger" tone="danger" title="Danger zone">{dangerCards}</SettingsGroup>}
    </SettingsLayout>
  );
}
