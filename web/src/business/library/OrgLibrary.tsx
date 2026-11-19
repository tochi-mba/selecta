import { useBusiness } from '../context';
import { LIBRARY_COPY } from '../copy/shell';
import { useLoad } from '../venue/useVenue';
import { ExplicitBulkEditor } from '../venue/ExplicitBulkEditor';

export function OrgLibrary() {
  const { org, client, readOnly, offline } = useBusiness();
  const library = useLoad(() => client.librarySongs(org.id), [client, org.id]);
  const disabled = readOnly ? LIBRARY_COPY.readOnly : offline ? LIBRARY_COPY.offline : null;
  return <section className="biz biz-stack"><h1>{LIBRARY_COPY.title(org.name)}</h1>
    <p>{LIBRARY_COPY.intro}</p>
    {library.loading && !library.data && <p role="status">{LIBRARY_COPY.loading}</p>}
    {Boolean(library.error) && <p role="alert">{LIBRARY_COPY.loadFailed} <button type="button" onClick={() => { void library.reload(); }}>{LIBRARY_COPY.retry}</button></p>}
    {!library.loading && !library.data?.length && <p>{LIBRARY_COPY.empty}</p>}
    {library.data && <section className="biz-card">
      <h2>{LIBRARY_COPY.explicitHeading}</h2>
      <ExplicitBulkEditor songs={library.data} disabled={disabled} onMark={async (song_ids, explicit) => {
        await client.markExplicit(org.id, { song_ids, explicit });
        await library.reload();
      }} />
    </section>}
  </section>;
}
