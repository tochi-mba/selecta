// The business pages, each its own lazy chunk, chosen by route (ADR-0453 D2). The pages are built
// by the other BZ-6 builders and read everything they need from useBusiness().

import { lazy, Suspense } from 'react';
import { Problem } from '../../ui/controls';
import type { BusinessRoute } from '../context';
import { SHELL_COPY } from '../copy/shell';
import type { Org } from '../types';
import { access } from './nav';

const HqConsole = lazy(() => import('../console/HqConsole').then((m) => ({ default: m.HqConsole })));
const VenuesPage = lazy(() => import('../console/VenuesPage').then((m) => ({ default: m.VenuesPage })));
const SchedulesPage = lazy(() => import('./sections').then((m) => ({ default: m.SchedulesPage })));
const BillingPage = lazy(() => import('./sections').then((m) => ({ default: m.BillingPage })));
const VenueManager = lazy(() => import('../venue/VenueManager').then((m) => ({ default: m.VenueManager })));
const PeoplePage = lazy(() => import('./sections').then((m) => ({ default: m.PeoplePage })));
const RequestsPage = lazy(() => import('./sections').then((m) => ({ default: m.RequestsPage })));
const StaffControl = lazy(() => import('./sections').then((m) => ({ default: m.StaffControl })));
const OnboardingPage = lazy(() => import('./sections').then((m) => ({ default: m.OnboardingPage })));
const OrgLibrary = lazy(() => import('./sections').then((m) => ({ default: m.OrgLibrary })));
const SettingsPage = lazy(() => import('./sections').then((m) => ({ default: m.SettingsPage })));

export function PageFallback() {
  return <p className="biz-quiet biz-page-loading" role="status">{SHELL_COPY.loadingPage}</p>;
}

/** A page the person can't open says why in plain words, with its own h1. */
export function Refused({ why }: { why: 'role' | 'flag' }) {
  return <section className="biz-stack"><h1>{why === 'role' ? 'Not part of your role' : 'Not switched on yet'}</h1><Problem>{why === 'role' ? SHELL_COPY.notInRole : SHELL_COPY.pageOff}</Problem></section>;
}

export function BusinessPage({ route, org, wall }: { route: NonNullable<BusinessRoute>; org: Org; wall?: boolean }) {
  const allowed = access(org, route);
  if (allowed !== 'ok') return <Refused why={allowed} />;
  const one = org.venue_scope && org.venue_scope.length === 1 ? org.venue_scope[0] : undefined;
  let page;
  switch (route.page) {
    case 'start': return null;
    case 'setup': page = <OnboardingPage />; break;
    case 'hq': page = <HqConsole wall={wall} />; break;
    case 'venues': page = <VenuesPage />; break;
    case 'venue': page = <VenueManager venueId={route.venue} tab={route.tab} />; break;
    case 'control': page = <StaffControl venueId={route.venue} />; break;
    case 'section':
      switch (route.section) {
        case 'schedules': page = <SchedulesPage />; break;
        case 'library': page = <OrgLibrary />; break;
        case 'requests': page = <RequestsPage />; break;
        case 'people': page = <PeoplePage venueId={org.role === 'venue_manager' ? one : undefined} />; break;
        case 'billing': page = <BillingPage />; break;
        case 'settings': page = <SettingsPage />; break;
      }
  }
  return <Suspense fallback={<PageFallback />}>{page}</Suspense>;
}
