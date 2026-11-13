import { useState } from 'react';
import { PATHS, useBusiness } from '../context';
import { BusinessDetailsForm } from '../onboarding/BusinessDetailsForm';

export function SettingsPage() {
  const { org, client, refresh, go, readOnly, offline } = useBusiness();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const canEdit = org.role === 'owner' || org.role === 'admin';
  const disabled = readOnly ? 'This organisation is read-only' : offline ? "You're offline" : !canEdit ? 'Only an owner or admin can edit settings' : null;
  return <section className="biz biz-stack"><h1>Organisation settings</h1>
    <section className="biz-card"><h2>Business details</h2>
      <BusinessDetailsForm initial={{ name: org.name, country: org.country }} disabled={disabled} submitLabel="Save business details"
        onSave={async (details) => {
          setError(''); setSaved(false);
          try { await client.saveBusinessDetails(org.id, details); await refresh(); setSaved(true); }
          catch { setError("Couldn't save business details. Try again."); }
        }} />
      {saved && <p role="status">Business details saved</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    <section className="biz-card"><h2>Management</h2>
      <p>Organisation: {org.name}</p>
      <p>Country: {org.country}</p>
      <p>Role: {org.role.replaceAll('_', ' ')}</p>
      <button type="button" onClick={() => go(PATHS.section(org.id, 'people'))}>People and permissions</button>
      <button type="button" onClick={() => go(PATHS.section(org.id, 'billing'))}>Billing and invoices</button>
    </section>
  </section>;
}
