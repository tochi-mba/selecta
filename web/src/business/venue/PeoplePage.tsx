// People (ADR-0452 BZ-0452-04/05/09, ADR-0453 D2): who works here, pending invitations and seats.
// Owners and admins manage everyone; a venue manager invites staff and viewers into free seats at
// their venues. An invitation is emailed when email is set up, and the link is always shown to
// copy too; owners and admins can buy a paid seat when none is free (business billing on).
// Removing someone ends their access to the organisation at once; their own SelectaDJ stays.

import { useState } from 'react';
import { Skeleton } from '../../ui/controls';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useBusiness } from '../context';
import { roleWords } from '../copy/venue';
import { useLoad } from './useVenue';
import type { Role } from '../types';

const ORG_ROLES: Role[] = ['admin', 'venue_manager', 'staff', 'viewer'];
const MANAGER_ROLES: Role[] = ['staff', 'viewer'];

/** The roles this person may hand out (nobody grants a role broader than their own). */
export function invitableRoles(role: Role): Role[] {
  if (role === 'owner' || role === 'admin') return ORG_ROLES;
  if (role === 'venue_manager') return MANAGER_ROLES;
  return [];
}

function expiresWords(at: number) {
  return `Link works until ${new Date(at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;
}

export function PeoplePage({ venueId }: { venueId?: string }) {
  const { org, venues, client, readOnly, offline } = useBusiness();
  const people = useLoad(() => client.people(), [client]);
  const roles = invitableRoles(org.role);
  const managerVenue = org.role === 'venue_manager' ? venueId ?? (org.venue_scope?.length === 1 ? org.venue_scope[0] : undefined) : venueId;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);
  const [working, setWorking] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const canInvite = roles.length > 0 && !readOnly && !offline && (org.role !== 'venue_manager' || Boolean(managerVenue));
  const canRemove = (org.role === 'owner' || org.role === 'admin') && !readOnly && !offline;
  const seats = people.data?.seats;
  const orgWide = role === 'admin' || (!managerVenue && role === 'viewer');
  const invite = async () => {
    if (!email.trim() || working) return;
    setWorking(true); setError(''); setLink(null);
    try {
      const made = await client.invite(org.id, { email: email.trim(), role, venue_ids: orgWide ? null : managerVenue ? [managerVenue] : venues.map((v) => v.id) });
      setLink({ email: made.invitation.email, url: new URL(made.accept_url, window.location.origin).toString(), emailed: made.emailed });
      setEmail('');
      await people.reload();
    } catch (problem) {
      setError((problem as Error).message || "The invitation couldn't be made. Try again.");
    } finally { setWorking(false); }
  };
  const revoke = async (id: string) => {
    setWorking(true); setError('');
    try { await client.revokeInvitation(id); await people.reload(); }
    catch { setError("Couldn't withdraw the invitation. Try again."); }
    finally { setWorking(false); }
  };
  const canBuySeats = (org.role === 'owner' || org.role === 'admin') && org.features['business.billing'] === true && !readOnly && !offline;
  const seatsFull = Boolean(seats && seats.held >= seats.included + seats.paid);
  const addSeat = async () => {
    if (!seats) return;
    setWorking(true); setError('');
    try { await client.setPaidSeats(seats.paid + 1); await people.reload(); }
    catch (problem) { setError((problem as Error).message || "Couldn't add a seat. Try again."); }
    finally { setWorking(false); }
  };
  const members = (people.data?.members ?? []).filter((member) => !venueId || member.venue_ids === null || member.venue_ids.includes(venueId));
  return <section className="biz biz-stack"><h1>People</h1>
    {people.loading && !people.data && <Skeleton variant="rows" lines={3} label="Loading people" />}
    {Boolean(people.error) && <p role="alert">Couldn't load people. <button type="button" onClick={() => { void people.reload(); }}>Retry</button></p>}
    {seats && <p className="biz-quiet">Seats: {seats.held} used of {seats.included + seats.paid} ({seats.included} included, {seats.paid} paid)</p>}
    {seats && seatsFull && canBuySeats && <p>All seats are in use. <button type="button" disabled={working} onClick={() => { void addSeat(); }}>Add a paid seat</button> It is billed from today.</p>}
    {seats && seatsFull && !canBuySeats && invitableRoles(org.role).length > 0 && <p className="biz-quiet">All seats are in use. An owner or admin can add a paid seat.</p>}
    <ul>{members.map((member) => <li key={member.id} className="biz-card">
      <strong>{member.name}</strong> ({member.email}): {roleWords(member.role)}
      {canRemove && member.role !== 'owner' && <button type="button" aria-label={`Remove ${member.name}`} disabled={working} onClick={() => setRemoving({ id: member.id, name: member.name })}>Remove</button>}
    </li>)}</ul>
    {(people.data?.invitations.length ?? 0) > 0 && <>
      <h2>Invited</h2>
      <ul>{people.data!.invitations.map((item) => <li key={item.id} className="biz-card">
        <strong>{item.email}</strong>: {roleWords(item.role)}. {expiresWords(item.expires_at)}
        {canInvite && <button type="button" disabled={working} aria-label={`Withdraw the invitation to ${item.email}`} onClick={() => { void revoke(item.id); }}>Withdraw</button>}
      </li>)}</ul>
    </>}
    {canInvite && <form className="biz-card biz-stack" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
      <h2>Invite someone</h2>
      <label>Email <input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Role <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
        {roles.map((option) => <option key={option} value={option}>{roleWords(option)}</option>)}
      </select></label>
      {managerVenue && !orgWide && <p>Access limited to {venues.find((v) => v.id === managerVenue)?.name ?? 'this venue'}.</p>}
      <p className="biz-quiet">We email them a link that works for 7 days, and show it here so you can send it yourself too.</p>
      <button type="submit" disabled={working}>{working ? 'Inviting' : 'Invite'}</button>
    </form>}
    {link && <section className="biz-card" aria-label="Invitation link">
      <p role="status">{link.emailed ? `We emailed ${link.email} an invitation. You can also send them this link.` : `We couldn't email ${link.email}. Send them this link yourself.`} They sign in with that email address to join.</p>
      <p><input readOnly aria-label="Invitation link" value={link.url} onFocus={(event) => event.currentTarget.select()} /></p>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(link.url); }}>Copy link</button>
    </section>}
    {!canInvite && <p className="biz-quiet">People can be managed by an owner, an admin or this venue's manager while online.</p>}
    {error && <p role="alert">{error}</p>}
    {removing && <ConfirmDialog
      title={`Remove ${removing.name} from this organisation?`}
      body="They lose access to its venues at once, and their devices here are signed out. Their own SelectaDJ is not affected, and kiosks they paired keep playing. You can invite them again any time."
      destructive
      onConfirm={async () => {
        setWorking(true); setError('');
        try { await client.removeMember(org.id, removing.id); await people.reload(); }
        catch { setError("Couldn't remove the person. Try again."); }
        finally { setWorking(false); }
      }}
      onClose={() => setRemoving(null)}
    />}
  </section>;
}
