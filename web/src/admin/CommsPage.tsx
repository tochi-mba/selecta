import { useState } from 'react';
import { useLoad } from './parts';
import { ActionButton, careful, REASONS, useConsole, write } from './safety';
import { AdminTable, Badge, Empty, Problem, Section, Time, words } from './ui';

type Banner = { id: string; text: string; level: 'info' | 'maintenance' | 'incident'; starts_at: number; ends_at: number | null; dismissable: boolean; created_at: number; ended_at: number | null };

/** The status banner every signed-in customer sees (doc 07b §7B.4, Communications). */
export function CommsPage() {
  const ctx = useConsole();
  const data = useLoad(() => ctx.api<{ current: Banner | null; history: Banner[] }>('/admin/banners'), [ctx.api]);
  const [text, setText] = useState('');
  const [level, setLevel] = useState<Banner['level']>('maintenance');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [dismissable, setDismissable] = useState(true);
  const epoch = (value: string) => (value ? new Date(value).getTime() / 1000 : null);
  const publish = () => ctx.ask({
    action: 'banner.publish', title: 'Publish the status banner', button: 'Publish to every customer',
    consequences: ['Every signed-in customer sees this banner.', data.data?.current ? 'It replaces the banner shown now.' : 'No banner is shown now.', 'End banner takes it down at any time.'],
    confirmText: 'publish', confirmLabel: 'Type publish to confirm', reasons: REASONS.incident, irreversible: false,
    run: async (_reason, confirm) => {
      await write(ctx.api, { path: '/admin/banners', body: { text, level, starts_at: epoch(starts), ends_at: epoch(ends), dismissable, confirm } });
      ctx.toast({ text: 'The banner is live. End banner takes it down.', tone: 'ok' }); setText(''); await data.reload();
    },
    done: 'Published.',
  });
  const end = (b: Banner) => careful(ctx, () => write(ctx.api, { path: `/admin/banners/${b.id}/end`, body: {} }).then(() => data.reload()), 'The banner is down.');
  const current = data.data?.current;
  return (
    <div className="admin-page">
      <Problem error={data.error} onRetry={() => void data.reload()} />
      <Section title="What customers see now" tour="banner-current">
        {current ? <><p className={`admin-banner-preview ${current.level}`}>{current.text}</p><p className="admin-soft">{words(current.level)}, since <Time at={current.starts_at} />{current.ends_at ? <>, ends <Time at={current.ends_at} /></> : ''}.</p>
          <ActionButton permission="platform.incidents.manage" onPress={() => void end(current)}>End banner</ActionButton></>
          : <Empty title="No banner is showing.">Customers see nothing extra. Write one below for maintenance or an incident.</Empty>}
      </Section>
      {ctx.can('platform.incidents.manage') && <Section title="Write a banner" tour="banner-form">
        <div className="admin-inline-form">
          <label>Text (at most 280 characters)<textarea value={text} maxLength={280} rows={2} onChange={(event) => setText(event.target.value)} /></label>
          <label>Kind<select value={level} onChange={(event) => setLevel(event.target.value as Banner['level'])}><option value="info">Information</option><option value="maintenance">Maintenance</option><option value="incident">Incident</option></select></label>
          <label>Starts (empty for now)<input type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} /></label>
          <label>Ends (optional)<input type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} /></label>
          <label className="admin-check"><input type="checkbox" checked={dismissable} onChange={(event) => setDismissable(event.target.checked)} /> Customers can close it</label>
        </div>
        <p className="admin-soft">Preview:</p>
        {text.trim() ? <p className={`admin-banner-preview ${level}`}>{text}</p> : <p className="admin-soft">Type the text to see it as customers will.</p>}
        <ActionButton permission="platform.incidents.manage" onPress={publish}>Publish…</ActionButton>
      </Section>}
      <Section title="Earlier banners" tour="banner-history">
        <AdminTable caption="Banner history" rows={data.data?.history ?? []} rowKey={(b) => b.id} loading={!data.data}
          empty={<Empty title="No banners yet." />}
          cols={[{ key: 'text', label: 'Text' }, { key: 'level', label: 'Kind', render: (b) => <Badge tone={b.level === 'incident' ? 'bad' : 'neutral'}>{words(b.level)}</Badge> }, { key: 'starts_at', label: 'From', render: (b) => <Time at={b.starts_at} /> }, { key: 'ended_at', label: 'Ended', render: (b) => <Time at={b.ended_at} /> }]} />
      </Section>
    </div>
  );
}
