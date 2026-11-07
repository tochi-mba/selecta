import type { IconName } from '../ui/Icon';
import type { Route, WorkshopTab } from '../router';

/** Every place in the app in one list: what it's called, where it lives and what it belongs to. The
 * navigation, page titles, breadcrumbs and the command palette all read this, so they can't disagree.
 * The older addresses stay the real ones. `router.ts` holds the friendlier aliases. */

export type DestinationId = 'listen' | 'explore' | 'mine' | 'library' | 'workspace';

export type Destination = { id: DestinationId; label: string; path: string; icon: IconName; about: string };

export const DESTINATIONS: Destination[] = [
  { id: 'listen', label: 'Listen', path: '/listen', icon: 'music', about: 'What’s playing, what’s next and the lyrics' },
  { id: 'explore', label: 'Make a Mix', path: '/mixes', icon: 'explore', about: 'Choose an idea, shape the journey, then play, edit or save it' },
  { id: 'mine', label: 'My Mixes', path: '/mixes/mine', icon: 'mixes', about: 'Your current mix, your drafts and the render line' },
  { id: 'library', label: 'Library', path: '/library', icon: 'library', about: 'Every song, with its details and corrections' },
  { id: 'workspace', label: 'Workspace', path: '/workshop', icon: 'settings', about: 'Analysis, folders, storage, learning and diagnostics' },
];

/** The kill switch's navigation: the older labels, over the very same pages. */
export const CLASSIC_DESTINATIONS: { path: string; label: string; icon: IconName; pages: Route['page'][] }[] = [
  { path: '/listen', label: 'Listen', icon: 'music', pages: ['listen'] },
  { path: '/mixes', label: 'Mixes', icon: 'mixes', pages: ['mixes', 'edit'] },
  { path: '/library', label: 'Library', icon: 'library', pages: ['library'] },
  { path: '/discover', label: 'Discover', icon: 'discover', pages: ['discover'] },
  { path: '/workshop', label: 'Workshop', icon: 'settings', pages: ['workshop', 'listening'] },
];

export const EXPLORE_TABS = [
  { path: '/mixes', label: 'Mix ideas' },
  { path: '/discover', label: 'Word connections' },
  { path: '/discover/harmonic', label: 'Harmonic matches' },
];

export const WORKSPACE_TABS: { tab: WorkshopTab; label: string; path: string }[] = [
  { tab: 'overview', label: 'Overview', path: '/workshop' },
  { tab: 'analysis', label: 'Analysis', path: '/workshop/analysis' },
  { tab: 'sources', label: 'Sources', path: '/workshop/sources' },
  { tab: 'storage', label: 'Storage', path: '/workshop/storage' },
  { tab: 'learning', label: 'Learning', path: '/workshop/learning' },
  { tab: 'diagnostics', label: 'Diagnostics', path: '/workshop/diagnostics' },
];

export function destinationOf(route: Route): DestinationId | null {
  switch (route.page) {
    case 'listen': return 'listen';
    case 'mixes': return route.tab === 'mine' ? 'mine' : 'explore';
    case 'discover': return 'explore';
    case 'edit': return 'mine';
    case 'library': return 'library';
    case 'workshop':
    case 'listening': return 'workspace';
    case 'missing': return null;
  }
}

export type Crumb = { label: string; path?: string };

/** What this page is called, and how it fits under where it belongs. */
export function describeRoute(route: Route): { title: string; crumbs: Crumb[] } {
  const explore: Crumb = { label: 'Make a Mix', path: '/mixes' };
  const mine: Crumb = { label: 'My Mixes', path: '/mixes/mine' };
  const workspace: Crumb = { label: 'Workspace', path: '/workshop' };
  switch (route.page) {
    case 'listen': return { title: 'Listen', crumbs: [{ label: 'Listen' }] };
    case 'mixes': return route.tab === 'mine'
      ? { title: 'My Mixes', crumbs: [{ label: 'My Mixes' }] }
      : { title: 'Make a Mix', crumbs: [{ label: 'Make a Mix' }] };
    case 'edit': return route.draft === null
      ? { title: 'Edit current mix', crumbs: [mine, { label: 'Edit current mix' }] }
      : { title: 'Edit draft', crumbs: [mine, { label: 'Edit draft' }] };
    case 'library': return { title: 'Library', crumbs: [{ label: 'Library' }] };
    case 'discover': return route.tab === 'harmonic'
      ? { title: 'Harmonic matches', crumbs: [explore, { label: 'Harmonic matches' }] }
      : { title: 'Word connections', crumbs: [explore, { label: 'Word connections' }] };
    case 'workshop': {
      if (route.tab === 'overview') return { title: 'Workspace', crumbs: [{ label: 'Workspace' }] };
      const label = WORKSPACE_TABS.find((item) => item.tab === route.tab)?.label ?? 'Workspace';
      return { title: label, crumbs: [workspace, { label }] };
    }
    case 'listening': return { title: 'Listening study', crumbs: [workspace, { label: 'Listening study' }] };
    case 'missing': return { title: 'Not found', crumbs: [{ label: 'Not found' }] };
  }
}
