import { useState } from 'react';
import { Skeleton } from '../../ui/controls';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useBusiness } from '../context';
import { roleWords } from '../copy/venue';
import { useLoad } from './useVenue';
import type { Role } from '../types';

const ROLES: Role[] = ['admin', 'venue_manager', 'staff', 'viewer'];
export function PeoplePage({ venueId }: { venueId?: string }) {
  const { org, venues, client, readOnly, offline } = useBusiness();
  const members = useLoad(() => client.members(org.id), [client, org.id]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const canManage = (org.role === 'owner' || org.role === 'admin') && !readOnly && !offline;
  const invite = async () => {
    if (!email.trim() || working) return;
    setWorking(true); setError('');
    try {
      await client.invite(org.id, { email: email.trim(), role, venue_ids: venueId ? [venueId] : null });
      setEmail('');
      await members.reload();
    } catch { setError("The invitation couldn't be sent. Try again."); }
    finally { setWorking(false); }
  };
  return <section className="biz biz-stack"><h1>People</h1>
    {members.loading && !members.data && <Skeleton variant="rows" lines={3} label="Loading people" />}
    {Boolean(members.error) && <p role="alert">Couldn't load people. <button type="button" onClick={() => { void members.reload(); }}>Retry</button></p>}
    <ul>{(members.data ?? []).filter((member) => !venueId || member.venue_ids === null || member.venue_ids.includes(venueId)).map((member) => <li key={member.id} className="biz-card">
      <strong>{member.name}</strong> ({member.email}): {roleWords(member.role)}
      {canManage && member.role !== 'owner' && <button type="button" aria-label={`Remove ${member.name}`} disabled={working} onClick={() => setRemoving({ id: member.id, name: member.name })}>Remove</button>}
    </li>)}</ul>
    {canManage && <form className="biz-card biz-stack" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
      <h2>Invite someone</h2>
      <label>Email <input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Role <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
        {ROLES.map((option) => <option key={option} value={option}>{roleWords(option)}</option>)}
      </select></label>
      {venueId && <p>Access limited to {venues.find((v) => v.id === venueId)?.name ?? 'this venue'}.</p>}
      <button type="submit" disabled={working}>{working ? 'Sending' : 'Send invite'}</button>
    </form>}
    {!canManage && <p className="biz-quiet">People can be managed by an owner or admin while online.</p>}
    {error && <p role="alert">{error}</p>}
    {removing && <ConfirmDialog
      title={`Remove ${removing.name} from this organisation?`}
      body="They lose access to its venues at once. You can invite them again any time."
      destructive
      onConfirm={async () => {
        setWorking(true); setError('');
        try { await client.removeMember(org.id, removing.id); await members.reload(); }
        catch { setError("Couldn't remove the person. Try again."); }
        finally { setWorking(false); }
      }}
      onClose={() => setRemoving(null)}
    />}
  </section>;
}
