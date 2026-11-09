import { flagOn, Gate, gateOpen, visible } from '../flags';
import type { IconName } from '../ui/Icon';
import { pathOf, type Route, type WorkshopTab } from '../router';

/** Every place in the app in one list: what it's called, where it lives and what it belongs to. The
 * navigation, page titles, breadcrumbs and the command palette all read this, so they can't disagree.
 * The older addresses stay the real ones. `router.ts` holds the friendlier aliases. */

export type DestinationId = 'listen' | 'explore' | 'mine' | 'library' | 'workspace';

export type Destination = { id: DestinationId; label: string; path: string; icon: IconName; about: string };

/** A list in words, `a, b and c`, of whichever parts are there. */
export function listed(parts: (string | false)[]): string {
  const shown = parts.filter((part): part is string => !!part);
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** What each destination holds, naming only what this build has. */
export function aboutOf(id: DestinationId): string {
  switch (id) {
    case 'listen': return listed(['What’s playing', 'what’s next', flagOn('listen.lyrics') && 'the lyrics']);
    case 'explore': return 'Choose an idea, shape the journey, then play, edit or save it';
    case 'mine': return `Your current mix${flagOn('drafts') ? `, your drafts${flagOn('render_line') ? ' and the render line' : ''}` : ''}`;
    case 'library': return flagOn('library.corrections') ? 'Every song, with its details and corrections' : 'Every song, with its details';
    case 'workspace': return listed(['Analysis', flagOn('library.folders') && 'folders', flagOn('workspace.storage') && 'storage', (flagOn('learning.memory') || flagOn('listening_study')) && 'learning', flagOn('workspace.diagnostics') && 'diagnostics']);
  }
}

export const DESTINATIONS: Destination[] = [
  { id: 'listen', label: 'Listen', path: '/listen', icon: 'music', about: 'What’s playing, what’s next and the lyrics' },
  { id: 'explore', label: 'Make a Mix', path: '/mixes', icon: 'explore', about: 'Choose an idea, shape the journey, then play, edit or save it' },
  { id: 'mine', label: 'My Mixes', path: '/mixes/mine', icon: 'mixes', about: 'Your current mix, your drafts and the render line' },
  { id: 'library', label: 'Library', path: '/library', icon: 'library', about: 'Every song, with its details and corrections' },
  { id: 'workspace', label: 'Workspace', path: '/workshop', icon: 'settings', about: 'Analysis, folders, storage, learning and diagnostics' },
];

/** The kill switch's navigation: the older labels, over the very same pages. */
const CLASSIC: ({ path: string; label: string; icon: IconName; pages: Route['page'][] } & Gate)[] = [
  { path: '/listen', label: 'Listen', icon: 'music', pages: ['listen'] },
  { path: '/mixes', label: 'Mixes', icon: 'mixes', pages: ['mixes', 'edit', 'lucy'] },
  { path: '/library', label: 'Library', icon: 'library', pages: ['library'] },
  { path: '/discover', label: 'Discover', icon: 'discover', pages: ['discover'], anyFlag: ['discover.word_links', 'discover.harmonic'] },
  { path: '/workshop', label: 'Workshop', icon: 'settings', pages: ['workshop', 'listening'] },
];

/** The classic navigation in this build. Discover goes to whichever of its pages is there. */
export function classicDestinations() {
  return visible(CLASSIC).map((item) => (item.path === '/discover' && !flagOn('discover.word_links') ? { ...item, path: '/discover/harmonic' } : item));
}

const EXPLORE: ({ path: string; label: string } & Gate)[] = [
  { path: '/mixes', label: 'Mix ideas' },
  { path: '/discover', label: 'Word connections', flag: 'discover.word_links' },
  { path: '/discover/harmonic', label: 'Harmonic matches', flag: 'discover.harmonic' },
];

/** Make a Mix's tabs in this build. With only one left, a page shows no tabs at all. */
export function exploreTabs() {
  return visible(EXPLORE);
}

const WORKSPACE: ({ tab: WorkshopTab; label: string; path: string } & Gate)[] = [
  { tab: 'overview', label: 'Overview', path: '/workshop' },
  { tab: 'analysis', label: 'Analysis', path: '/workshop/analysis' },
  { tab: 'sources', label: 'Sources', path: '/workshop/sources', flag: 'library.folders' },
  { tab: 'storage', label: 'Storage', path: '/workshop/storage', anyFlag: ['workspace.storage', 'workspace.backup'] },
  { tab: 'learning', label: 'Learning', path: '/workshop/learning', anyFlag: ['learning.memory', 'listening_study'] },
  { tab: 'diagnostics', label: 'Diagnostics', path: '/workshop/diagnostics', flag: 'workspace.diagnostics' },
];

/** Workspace's tabs in this build: a tab with nothing left in it is gone. */
export function workspaceTabs() {
  return visible(WORKSPACE);
}

/** The page to show for an address: itself, or Not Found when this build doesn't have it. */
export function shownRoute(route: Route): Route {
  return routeOn(route) ? route : { page: 'missing', path: pathOf(route) };
}

/** Whether this build has the page at all. A page that's off is Not Found, as if never built. */
export function routeOn(route: Route): boolean {
  switch (route.page) {
    case 'edit': return gateOpen({ flag: route.draft === null ? 'editor' : ['editor', 'drafts'] });
    case 'discover': return flagOn(route.tab === 'harmonic' ? 'discover.harmonic' : 'discover.word_links');
    case 'workshop': {
      const tab = WORKSPACE.find((item) => item.tab === route.tab);
      return !tab || gateOpen(tab);
    }
    case 'listening': return flagOn('listening_study');
    case 'lucy': return flagOn('lucy');
    default: return true;
  }
}

export function destinationOf(route: Route): DestinationId | null {
  switch (route.page) {
    case 'listen': return 'listen';
    case 'mixes': return route.tab === 'mine' ? 'mine' : 'explore';
    case 'discover':
    case 'lucy': return 'explore';
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
      const label = WORKSPACE.find((item) => item.tab === route.tab)?.label ?? 'Workspace';
      return { title: label, crumbs: [workspace, { label }] };
    }
    case 'listening': return { title: 'Listening study', crumbs: [workspace, { label: 'Listening study' }] };
    case 'lucy': return { title: 'Lucy', crumbs: [explore, { label: 'Lucy' }] };
    case 'missing': return { title: 'Not found', crumbs: [{ label: 'Not found' }] };
  }
}
