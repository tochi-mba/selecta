// S2, the HQ multi-venue console (ADR-0453 D7, BZ-0453-08, BZ-0453-09 S2 side).
//
// Layout: desktop puts Needs attention (a complementary landmark) beside the health grid; tablet
// (768 to 1023 px) folds it into a chip with a count above the grid; phone (under 768 px) shows a
// list of venue cards sorted by severity. Wall mode shows the grid only, for an operations room.
//
// Wall mode contract for the shell: while it is on, `document.documentElement` carries
// `data-wall="on"` (removed when it goes off or this page unmounts). The shell hides its rail, tab
// bar and WorkspaceBand while that attribute is present.

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '../../ui/controls';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { useVisiblePoll } from '../../ui/useVisiblePoll';
import { NeedsAttentionList, PilotBadge, SilentZoneAlert, StateBanners } from '../components/Notices';
import { CONSOLE_COPY } from '../copy/console';
import { MANAGER_COPY, StateContext } from '../copy/states';
import { PATHS, useBusiness } from '../context';
import { BusinessState, canManageBilling, deriveStates, splitBanners } from '../state';
import { venueTime } from '../time';
import { arrangeVenues, DEFAULT_OPTIONS } from './consoleLogic';
import { VenueHealthCard } from './VenueHealthCard';
import { VenueHealthGrid } from './VenueHealthGrid';
import { HqLocalReadiness, localFirstOn } from '../localFirst/ReadinessPanel';
import './console.css';

const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function HqConsole({ wall: wallProp = false }: { wall?: boolean }) {
  const { org, venues, now, offline, health, loading, updatedAt, go, refresh } = useBusiness();
  const [wall, setWall] = useState(wallProp);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const phone = useMediaQuery('(max-width: 767px)');
  const tablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  const polling = health.stream === 'polling';

  useEffect(() => setWall(wallProp), [wallProp]);
  useEffect(() => {
    const root = document.documentElement;
    if (wall) root.setAttribute('data-wall', 'on');
    else root.removeAttribute('data-wall');
    return () => root.removeAttribute('data-wall');
  }, [wall]);

  // Live updates paused: read again every 10 seconds, as the line above the grid promises.
  useVisiblePoll(refresh, 10_000, polling && !offline);

  const states = useMemo(() => deriveStates({ org, venues, health, offline, now }), [org, venues, health, offline, now]);
  // No alert is cleared while offline: keep the last silent list known online, plus anything new.
  const lastSilent = useRef<BusinessState[]>([]);
  const liveSilent = states.filter((state) => state.kind === 'silent_zone');
  if (!offline) lastSilent.current = liveSilent;
  const silent = offline ? [...lastSilent.current, ...liveSilent.filter((state) => !lastSilent.current.some((kept) => kept.key === state.key))] : liveSilent;
  const others = states.filter((state) => state.kind !== 'silent_zone' && state.kind !== 'offline' && !(state.kind === 'degraded' && polling));
  const { banners, attention } = splitBanners(others);
  const ctx: StateContext = { org, venues, now, scope: 'hq' };
  const openVenue = (id: string) => go(PATHS.venue(org.id, id));
  const ownerOrAdmin = canManageBilling(org);

  const actions = (state: BusinessState): ReactNode => {
    if ((state.kind === 'licence_expired' || state.kind === 'licence_expiring') && state.venue_id) {
      return <button type="button" onClick={() => go(PATHS.venue(org.id, state.venue_id!, 'licence'))}>{CONSOLE_COPY.updateLicence}</button>;
    }
    if ((state.kind === 'payment_grace' || state.kind === 'payment_grace_final') && ownerOrAdmin) {
      return <button type="button" onClick={() => go(PATHS.section(org.id, 'billing'))}>{CONSOLE_COPY.updateCard}</button>;
    }
    if (state.kind === 'over_seats' && ownerOrAdmin) {
      return <span className="biz-row">
        <button type="button" onClick={() => go(PATHS.section(org.id, 'people'))}>{CONSOLE_COPY.removeSomeone}</button>
        <button type="button" onClick={() => go(PATHS.section(org.id, 'billing'))}>{CONSOLE_COPY.addSeats}</button>
      </span>;
    }
    return null;
  };

  const heading = <div className="hq-title biz-row">
    <h1>{CONSOLE_COPY.overviewTitle(org.name)}</h1>
    <PilotBadge pilot={org.pilot} now={now} />
    <button type="button" className="hq-wall-toggle" aria-pressed={wall} onClick={() => setWall(!wall)}>{CONSOLE_COPY.wallMode}</button>
  </div>;

  const lines = <>
    {offline && <p className="hq-line" role="status">{MANAGER_COPY.offlineHq(venueTime(updatedAt ?? now, viewerZone()))}</p>}
    {!offline && polling && <p className="hq-line" role="status">{MANAGER_COPY.liveUpdatesPaused}</p>}
  </>;

  if (!loading && venues.length === 0) {
    const noAccess = org.role === 'viewer' || (org.venue_scope != null && org.role !== 'owner' && org.role !== 'admin');
    const pilotWords = org.pilot && org.pilot.status !== 'converted' ? CONSOLE_COPY.pilotFirstVenue(org.pilot.allowance.venues) : null;
    return <div className="biz hq" data-wall={wall || undefined}>
      {heading}
      <StateBanners banners={banners} ctx={ctx} actions={actions} />
      <div className="biz-card hq-empty">
        {noAccess ? <p>{CONSOLE_COPY.noAccess}</p> : <>
          <p>{pilotWords ?? CONSOLE_COPY.addFirstVenue}</p>
          <button type="button" className="hq-primary" onClick={() => go(PATHS.setup(org.id))}>{CONSOLE_COPY.addVenue}</button>
        </>}
      </div>
    </div>;
  }

  const grid = loading
    ? <div className="hq-grid-section" data-skeleton-rows={venues.length || 3}><Skeleton variant="rows" lines={venues.length || 3} label={CONSOLE_COPY.loadingGrid} /></div>
    : <VenueHealthGrid venues={venues} now={now} offline={offline} updatedAt={updatedAt} onOpenVenue={openVenue} wall={wall} />;

  if (wall) {
    return <div className="biz hq hq-wall" data-wall="">
      {heading}
      {lines}
      {grid}
    </div>;
  }

  const attentionList = <NeedsAttentionList items={attention} ctx={ctx} loading={loading} actions={actions} />;
  const chip = <div className="hq-attention-chip">
    <button type="button" aria-expanded={attentionOpen} aria-controls="hq-attention-panel" onClick={() => setAttentionOpen(!attentionOpen)}>
      {loading ? CONSOLE_COPY.checkingVenues : CONSOLE_COPY.needsAttentionChip(attention.length)}
    </button>
    <div id="hq-attention-panel" hidden={!attentionOpen}>{attentionOpen && attentionList}</div>
  </div>;

  return <div className="biz hq">
    {heading}
    <SilentZoneAlert silent={silent} venues={venues} now={now} scope="hq" onOpenVenue={openVenue} />
    <StateBanners banners={banners} ctx={ctx} actions={actions} />
    {lines}
    {localFirstOn(org.features) && <HqLocalReadiness venues={venues} now={now} offline={offline} onOpenVenue={openVenue} />}
    {phone ? <>
      {chip}
      {loading ? grid : <section aria-labelledby="hq-cards-title" className="hq-cards-section">
        <h2 id="hq-cards-title">{CONSOLE_COPY.venuesHeading}</h2>
        <div className="hq-cards">{arrangeVenues(venues, DEFAULT_OPTIONS, now).map((venue) => <VenueHealthCard key={venue.id} venue={venue} now={now} offline={offline} updatedAt={updatedAt} onOpen={openVenue} />)}</div>
      </section>}
    </> : tablet ? <>
      {chip}
      {grid}
    </> : <div className="hq-layout">
      {attentionList}
      {grid}
    </div>}
  </div>;
}
