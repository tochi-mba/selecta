import { useBusiness } from '../context';
import { useLoad } from '../venue/useVenue';
import { ExplicitBulkEditor } from '../venue/ExplicitBulkEditor';

export function OrgLibrary() {
  const { org, client, readOnly, offline } = useBusiness();
  const library = useLoad(() => client.librarySongs(org.id), [client, org.id]);
  const disabled = readOnly ? 'This organisation is read-only' : offline ? "You're offline" : null;
  return <section className="biz biz-stack"><h1>{org.name} music library</h1>
    <p>Music you manage here belongs to the organisation, not your personal library.</p>
    {library.loading && !library.data && <p role="status">Loading music library</p>}
    {library.error && <p role="alert">Couldn't load music. <button type="button" onClick={() => { void library.reload(); }}>Retry</button></p>}
    {!library.loading && !library.data?.length && <p>No music here yet. Add music to your organisation to make a mix.</p>}
    {library.data && <section className="biz-card">
      <h2>Explicit markings</h2>
      <ExplicitBulkEditor songs={library.data} disabled={disabled} onMark={async (song_ids, explicit) => {
        await client.markExplicit(org.id, { song_ids, explicit });
        await library.reload();
      }} />
    </section>}
  </section>;
}
