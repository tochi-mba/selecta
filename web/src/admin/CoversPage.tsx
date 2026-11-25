import { FormEvent, useState } from 'react';
import { apiOrigin } from './adminApi';
import { Command, useLoad } from './parts';
import { AdminRoute, setQuery } from './route';
import { useConsole, write } from './safety';
import { AdminTable, Badge, CopyId, Empty, Problem, Section, Time } from './ui';

type Art = {
  id: string; release_id: string; title: string | null; artist: string | null; year: number | null;
  source: string; sizes: string[]; preview: string | null; fetched_at: number;
  hidden: boolean; hidden_reason: string | null; hidden_at: number | null; hidden_by: string | null;
};

const SOURCES: Record<string, string> = {
  'caa-release': 'Cover Art Archive, this release',
  'caa-release-group': 'Cover Art Archive, its release group',
};

// The image route sends `Cache-Control: private, max-age=3600` (catalog/routes.py CACHE_CONTROL),
// so a hide stops our serving at once but a browser that already holds the image may show it for
// up to an hour. Staff must be told, so nobody reports the hide as failed in that hour.
const CACHE_WORDS = 'SelectaDJ stopped serving it at once. Browsers that already loaded it may keep their copy for up to an hour.';

/**
 * Hide or unhide a catalogue cover (ADR-0478): a takedown tool, so it stays plain and deliberate.
 * Each change goes through the server's command route with a required reason and lands in the
 * audit log; the page only finds the image and shows its state.
 */
export function CoversPage({ route }: { route: AdminRoute }) {
  const ctx = useConsole();
  const q = route.query.get('q') ?? '';
  const [typed, setTyped] = useState(q);
  const [done, setDone] = useState('');
  const art = useLoad(() => ctx.api<{ art: Art[]; limit: number }>(`/admin/catalog/art?q=${encodeURIComponent(q)}`), [ctx.api, q]);
  const rows = art.data?.art ?? [];
  const viewing = ctx.changesUntil === null;
  const search = (event: FormEvent) => { event.preventDefault(); setDone(''); setQuery({ q: typed.trim() || undefined }); };
  const change = async (row: Art, command: 'hide' | 'unhide', reason: string) => {
    await write(ctx.api, { path: `/admin/catalog/art/${encodeURIComponent(row.id)}/${command}`, body: { reason } });
    const name = row.title ? `the cover of ${row.title}` : `image ${row.id.slice(0, 8)}`;
    setDone(command === 'hide' ? `Hidden: ${name}. ${CACHE_WORDS}` : `Shown again: ${name}.`);
    await art.reload();
  };
  return (
    <div className="admin-page">
      <Section title="Find a cover" tour="covers-search">
        <form className="admin-inline-form" role="search" onSubmit={search}>
          <label>Song, release, artist, art id or release id
            <input type="search" value={typed} onChange={(event) => setTyped(event.target.value)} maxLength={200} />
          </label>
          <button className="primary">Find</button>
        </form>
        <p className="admin-note">{q ? `Images matching “${q}”, newest first.` : 'The newest images. Type words or an id to narrow them.'} At most {art.data?.limit ?? 50} are listed.</p>
      </Section>
      {done && <p className="admin-covers-done" role="status">{done}</p>}
      <Problem error={art.error} onRetry={() => void art.reload()} />
      <Section title="Catalogue covers" tour="covers-list">
        <AdminTable caption="Catalogue covers" rows={rows} rowKey={(row) => row.id} loading={!art.data && !art.error}
          empty={<Empty title={q ? 'No cover matches.' : 'The catalogue has no covers.'}>{q ? 'Try the song’s title alone, the artist, or paste the art id from a report.' : 'Covers appear here once lookups have stored some.'}</Empty>}
          cols={[
            { key: 'cover', label: 'Cover', render: (row) => <Cover row={row} /> },
            { key: 'title', label: 'Release', sort: (row) => (row.title ?? '').toLowerCase(), render: (row) => <span className="admin-covers-what"><strong>{row.title ?? 'Untitled release'}</strong><span className="admin-soft">{[row.artist, row.year].filter(Boolean).join(', ')}</span></span> },
            { key: 'source', label: 'Source', render: (row) => SOURCES[row.source] ?? row.source },
            { key: 'id', label: 'Art id', render: (row) => <CopyId id={row.id} label="art id" /> },
            { key: 'release_id', label: 'Release id', optional: true, render: (row) => <CopyId id={row.release_id} label="release id" /> },
            { key: 'fetched_at', label: 'Stored', sort: (row) => row.fetched_at, render: (row) => <Time at={row.fetched_at} /> },
            { key: 'hidden', label: 'State', sort: (row) => Number(row.hidden), render: (row) => (row.hidden
              ? <span className="admin-covers-what"><Badge tone="bad">Hidden</Badge><span className="admin-soft">{row.hidden_reason}{row.hidden_at ? <>, <Time at={row.hidden_at} /></> : null}</span></span>
              : <Badge>Shown</Badge>) },
            { key: 'act', label: 'Change', render: (row) => (viewing
              ? <small className="admin-soft">Press Make changes first</small>
              : row.hidden
                ? <Command label="Unhide" note="It is served again to every account whose song uses it." run={(reason) => change(row, 'unhide', reason)} />
                : <Command label="Hide" danger note={`Every account stops seeing this cover and gets the generated tile. ${CACHE_WORDS}`} run={(reason) => change(row, 'hide', reason)} />) },
          ]} />
      </Section>
    </div>
  );
}

function Cover({ row }: { row: Art }) {
  if (row.preview) return <img className="admin-cover" src={`${apiOrigin}${row.preview}`} alt={`Cover of ${row.title ?? 'this release'}`} loading="lazy" />;
  return <span className="admin-cover admin-cover-none admin-soft">{row.hidden ? 'Not served while hidden' : 'No stored size'}</span>;
}
