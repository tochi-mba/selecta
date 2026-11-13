// S3 Music rules (ADR-0450, ADR-0453 D8): the rules editor, the bulk explicit editor and the
// blocklist, with the server's empty-pool refusal named by zone.

import { useState } from 'react';
import { Problem, Skeleton } from '../../ui/controls';
import { showToast } from '../../ui/toasts';
import { businessOn, useBusiness } from '../context';
import { VENUE_COPY } from '../copy/venue';
import type { ContentRules, Daypart, Venue } from '../types';
import { BlocklistEditor } from './BlocklistEditor';
import { ContentRulesEditor, type CrateChoice } from './ContentRulesEditor';
import { ExplicitBulkEditor } from './ExplicitBulkEditor';
import { refusal, useLoad } from './useVenue';

const EMPTY_RULES: ContentRules = { explicit: 'block', blocklist: [], allowed_crates: [], brand: {}, volume_caps: {}, quiet_hours: [] };
const EMPTY_POOL_CODES = new Set(['rules_empty_pool', 'empty_pool', 'no_allowed_songs']);

/** The words for a refused rules save: the ADR-0450 empty-pool refusal names the zone. */
export function rulesRefusalWords(error: unknown, venue: Venue): string {
  const { code, detail } = refusal(error);
  if (code && EMPTY_POOL_CODES.has(code)) {
    const zone = venue.zones.find((item) => item.id === detail.zone_id)?.name ?? (typeof detail.zone_name === 'string' ? detail.zone_name : venue.zones[0]?.name ?? venue.name);
    return VENUE_COPY.emptyPool(zone);
  }
  return VENUE_COPY.rulesFailed;
}

export function RulesTab({ venue, disabled }: { venue: Venue; disabled: string | null }) {
  const { client, org, bizApi } = useBusiness();
  const [refused, setRefused] = useState<string | null>(null);
  const rules = useLoad(async () => (await client.rules(org.id, venue.id)) ?? EMPTY_RULES, [client, org.id, venue.id]);
  const songs = useLoad(async () => (await client.librarySongs(org.id)) ?? [], [client, org.id]);
  const crates = useLoad<CrateChoice[]>(async () => (bizApi ? (await bizApi.listCrates(venue.id)).map((crate) => ({ id: crate.id, name: crate.name })) : []), [bizApi, venue.id]);
  const dayparts = useLoad<Record<string, Daypart[]>>(async () => {
    const entries = await Promise.all(venue.zones.map(async (zone) => [zone.id, (await client.schedule(zone.id).catch(() => null))?.dayparts ?? []] as const));
    return Object.fromEntries(entries);
  }, [client, venue.zones]);

  const save = async (next: ContentRules) => {
    setRefused(null);
    try {
      const saved = await client.saveRules(org.id, venue.id, next);
      rules.set(saved ?? next);
      showToast(VENUE_COPY.rulesSaved);
    } catch (error) {
      setRefused(rulesRefusalWords(error, venue));
    }
  };

  if (!venue.zones.length) return <div className="biz-card"><p>{VENUE_COPY.noZones}</p></div>;
  if (rules.error && !rules.data) return <Problem retry={rules.reload}>{VENUE_COPY.rulesFailed}</Problem>;
  if (!rules.data) return <Skeleton lines={6} label={VENUE_COPY.loading} />;
  const current = rules.data;
  return <div className="biz-stack">
    <h2>{VENUE_COPY.rulesHeading}</h2>
    <div className="biz-card">
      <ContentRulesEditor rules={current} zones={venue.zones} crates={crates.data ?? []} dayparts={dayparts.data ?? {}} onSave={save} disabled={disabled} refusal={refused} />
    </div>
    <div className="biz-card">
      <BlocklistEditor items={current.blocklist} songs={songs.data ?? []} disabled={disabled} onChange={(blocklist) => save({ ...current, blocklist })} />
    </div>
    {businessOn(org.features, 'business.content_controls.bulk') !== false && <div className="biz-card">
      {songs.loading && !songs.data ? <Skeleton lines={4} label={VENUE_COPY.loading} /> : (
        <ExplicitBulkEditor songs={songs.data ?? []} disabled={disabled} onMark={async (ids, explicit) => {
          await client.markExplicit(org.id, { song_ids: ids, explicit });
          songs.set((songs.data ?? []).map((song) => (ids.includes(song.id) ? { ...song, explicit } : song)));
        }} />
      )}
    </div>}
  </div>;
}
