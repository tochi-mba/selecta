/** Browser Cloud uses the same primary destinations, icons and names as local Selecta.
 * The Cloud-specific destinations are an extension, not a competing navigation model.
 * No local audio runtime is imported by this presentation-only component. */
import { Icon, type IconName } from '../ui/Icon';
import { DESTINATIONS, type DestinationId } from '../shell/manifest';
import type { Page } from './api';

export type PersonalDestination = DestinationId | 'home' | 'studio' | 'connect'
  | 'devices' | 'rooms' | 'billing' | 'settings';

type NavigationItem = {
  id: PersonalDestination;
  label: string;
  path: string;
  icon: IconName;
  description: string;
};

export const PRIMARY_PERSONAL_DESTINATIONS: readonly NavigationItem[] = DESTINATIONS.map(
  (destination) => ({
    id: destination.id, label: destination.label, path: destination.path,
    icon: destination.icon, description: destination.about,
  }),
);

/** Cloud-only capabilities remain reachable without changing the established local UI. */
export const CLOUD_PERSONAL_DESTINATIONS: readonly NavigationItem[] = [
  { id: 'home', label: 'Overview', path: '/', icon: 'rail',
    description: 'Your workspace and quick actions' },
  { id: 'studio', label: 'Studio', path: '/studio', icon: 'edit',
    description: 'Arrange cues, transitions, and portable recipe revisions' },
  { id: 'connect', label: 'Connect Music', path: '/upload', icon: 'folder',
    description: 'Authorise recordings on the device you are using' },
  { id: 'devices', label: 'Devices', path: '/devices', icon: 'system',
    description: 'Check local output or control an authorised remote speaker' },
  { id: 'rooms', label: 'Rooms', path: '/rooms', icon: 'request',
    description: 'Host and moderate guest requests when entitled' },
  { id: 'billing', label: 'Plan & billing', path: '/account/billing', icon: 'circle',
    description: 'Subscriptions and Cloud services' },
  { id: 'settings', label: 'Account settings', path: '/account', icon: 'settings',
    description: 'Your account, privacy and preferences' },
];

export function personalDestination(pathname: string): PersonalDestination | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/player') return 'listen';
  if (path === '/discover' || path === '/discover/words' ||
      path === '/discover/harmonic') return 'explore';
  if (path === '/workspace') return 'workspace';
  if (path === '/uploads') return 'connect';
  const item = [...PRIMARY_PERSONAL_DESTINATIONS, ...CLOUD_PERSONAL_DESTINATIONS]
    .find((destination) => destination.path === path);
  return item?.id ?? null;
}

export const PERSONAL_PAGE: Record<PersonalDestination, Page> = {
  home: 'home', listen: 'listen', explore: 'listen', mine: 'listen',
  library: 'library', workspace: 'home', studio: 'listen', connect: 'uploads',
  devices: 'settings', rooms: 'listen', billing: 'billing', settings: 'settings',
};

export function personalDescription(destination: PersonalDestination): string {
  const item = [...PRIMARY_PERSONAL_DESTINATIONS, ...CLOUD_PERSONAL_DESTINATIONS]
    .find((candidate) => candidate.id === destination);
  return item?.description ?? '';
}

export function personalTitle(destination: PersonalDestination): string {
  if (destination === 'home') return 'Your music workspace';
  return [...PRIMARY_PERSONAL_DESTINATIONS, ...CLOUD_PERSONAL_DESTINATIONS]
    .find((candidate) => candidate.id === destination)?.label ?? 'Workspace';
}

export function CloudPersonalNavigation({
  active, go, roomsAvailable,
}: {
  active: PersonalDestination | null;
  go: (path: string) => void;
  roomsAvailable: boolean;
}) {
  const button = (item: NavigationItem) => (
    <a href={item.path} key={item.id} className="cloud-personal-nav-link"
      data-destination={item.id}
      aria-current={active === item.id ? 'page' : undefined}
      title={item.description} onClick={(event) => {
        // Match local PageLink semantics: open-in-new-tab and copy-link still work.
        if (event.button !== 0 || event.ctrlKey || event.metaKey ||
            event.shiftKey || event.altKey) return;
        event.preventDefault();
        const menu = event.currentTarget.closest('details');
        if (menu) menu.open = false;
        go(item.path);
      }}>
      <Icon name={item.icon} />
      <span className="cloud-personal-nav-label">{item.label}</span>
    </a>
  );
  return <>
    <div className="cloud-personal-primary" aria-label="Local Selecta destinations">
      {PRIMARY_PERSONAL_DESTINATIONS.filter((item) => item.id !== 'workspace').map(button)}
    </div>
    <details className="cloud-personal-more">
      <summary><Icon name="more" /><span>Cloud & account</span></summary>
      <div className="cloud-personal-secondary">
        {PRIMARY_PERSONAL_DESTINATIONS.filter((item) => item.id === 'workspace').map(button)}
        {CLOUD_PERSONAL_DESTINATIONS
          .filter((item) => item.id !== 'rooms' || roomsAvailable)
          .map(button)}
      </div>
    </details>
  </>;
}
