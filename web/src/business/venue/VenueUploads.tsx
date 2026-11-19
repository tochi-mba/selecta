// S3 Upload music (ADR-0448): the organisation's own upload panel, with every file counted
// against this venue in the pooled storage, so the Usage page shows real per-venue use.

import { useState } from 'react';
import { UploadsPanel } from '../../cloud/Uploads';
import { useBusiness } from '../context';

export function VenueUploads({ venueId, disabled }: { venueId: string; disabled: string | null }) {
  const { api, org, refresh } = useBusiness();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!api) return null;
  return <section className="biz-card" aria-labelledby={`venue-uploads-${venueId}`}>
    <h2 id={`venue-uploads-${venueId}`}>Upload music for this venue</h2>
    <p className="biz-quiet">Songs go into your organisation's shared library and count towards this venue's storage on the Usage page.</p>
    <UploadsPanel api={api} workspaceId={org.id} venueId={venueId} setError={setError} setNotice={setNotice}
      blocked={disabled} onAccepted={() => void refresh()} />
    {error && <p className="warn" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
