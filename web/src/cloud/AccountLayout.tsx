import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { navigate } from '../router';
import { Icon, IconName } from '../ui/Icon';
import './account.css';

// The settings area's frame: a list of sections down the left on a wide window (a scrolling row of
// tabs on a phone), and each section a titled card with one line about it and its actions at the
// right. Account, Plan & billing and Devices all sit in it, so the three pages read as one place.

export type SettingsPlaceId = 'profile' | 'billing' | 'devices' | 'lucy' | 'data' | 'advanced';
export type SettingsPlace = { id: SettingsPlaceId; label: string; icon: IconName; path: string; anchor?: string };

const ACCOUNT_PATH = '/account';
export const SETTINGS_ANCHORS = { profile: 'settings-profile', lucy: 'settings-lucy', data: 'settings-data', advanced: 'settings-advanced' } as const;

/** The sections this account has, in reading order. A section that is off is not listed. */
export function settingsPlaces(shown: { devices: boolean; lucy: boolean; advanced: boolean }): SettingsPlace[] {
  const places: (SettingsPlace | false)[] = [
    { id: 'profile', label: 'Profile', icon: 'user', path: ACCOUNT_PATH, anchor: SETTINGS_ANCHORS.profile },
    { id: 'billing', label: 'Plan & billing', icon: 'card', path: '/account/billing' },
    shown.devices && { id: 'devices', label: 'Devices', icon: 'system', path: '/account/devices' },
    shown.lucy && { id: 'lucy', label: 'Lucy', icon: 'discover', path: ACCOUNT_PATH, anchor: SETTINGS_ANCHORS.lucy },
    { id: 'data', label: 'Data & privacy', icon: 'lock', path: ACCOUNT_PATH, anchor: SETTINGS_ANCHORS.data },
    shown.advanced && { id: 'advanced', label: 'Advanced', icon: 'settings', path: ACCOUNT_PATH, anchor: SETTINGS_ANCHORS.advanced },
  ];
  return places.filter((place): place is SettingsPlace => Boolean(place));
}

// A section asked for from another settings page: Account scrolls to it once it has drawn.
let pendingAnchor: string | null = null;

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

function showAnchor(anchor: string) {
  const target = document.getElementById(anchor);
  if (!target) return false;
  target.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  target.querySelector<HTMLElement>('[data-settings-title]')?.focus({ preventScroll: true });
  return true;
}

export function SettingsLayout({ current, places, children }: {
  /** the page being shown: `profile` for Account, whose other sections are found by scrolling */
  current: 'profile' | 'billing' | 'devices';
  /** left out where the frame has no settings pages of its own; the cards then fill the column */
  places?: SettingsPlace[];
  children: ReactNode;
}) {
  const onAccount = current === 'profile';
  const [inView, setInView] = useState<SettingsPlaceId>('profile');

  useEffect(() => {
    if (!onAccount || !pendingAnchor) return;
    const anchor = pendingAnchor;
    pendingAnchor = null;
    // a section that loads its own content (Lucy) can still be growing: try again briefly
    if (!showAnchor(anchor)) { const timer = window.setTimeout(() => showAnchor(anchor), 400); return () => window.clearTimeout(timer); }
    return undefined;
  }, [onAccount]);

  // Which section of Account is on screen, so the list on the left always says where you are; and
  // which sections turned out to have nothing in them, so the list never points at an empty place.
  const [empty, setEmpty] = useState<SettingsPlaceId[]>([]);
  useEffect(() => {
    if (!onAccount || !places) return undefined;
    const anchored = places.filter((place) => place.anchor);
    const read = () => {
      const line = window.innerHeight * 0.35;
      let found: SettingsPlaceId = 'profile';
      const gone: SettingsPlaceId[] = [];
      for (const place of anchored) {
        const node = document.getElementById(place.anchor!);
        if (!node || node.getClientRects().length === 0) { gone.push(place.id); continue; }
        if (node.getBoundingClientRect().top <= line) found = place.id;
      }
      setInView(found);
      setEmpty((was) => (was.join() === gone.join() ? was : gone));
    };
    read();
    const timer = window.setInterval(read, 1500);
    document.addEventListener('scroll', read, { capture: true, passive: true });
    return () => { window.clearInterval(timer); document.removeEventListener('scroll', read, { capture: true }); };
  }, [onAccount, places]);

  if (!places) return <div className="acct"><div className="acct-content">{children}</div></div>;

  const active = onAccount ? inView : current;
  const open = (place: SettingsPlace) => {
    if (place.path === ACCOUNT_PATH && onAccount) {
      if (place.anchor) { showAnchor(place.anchor); setInView(place.id); }
      return;
    }
    pendingAnchor = place.anchor ?? null;
    navigate(place.path);
  };
  return (
    <div className="acct acct-layout">
      <nav className="acct-nav" aria-label="Settings sections">
        {places.filter((place) => !onAccount || !empty.includes(place.id)).map((place) => (
          <a
            key={place.id}
            href={place.anchor && place.id !== 'profile' ? `${place.path}#${place.anchor}` : place.path}
            aria-current={active === place.id ? (place.anchor && onAccount ? 'location' : 'page') : undefined}
            onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); open(place); }}
          >
            <Icon name={place.icon} size="toolbar" />
            <span>{place.label}</span>
          </a>
        ))}
      </nav>
      <div className="acct-content">{children}</div>
    </div>
  );
}

// A card inside a named group is a level below the group's own heading.
const Level = createContext<2 | 3>(2);

/** A named run of cards on the Account page ("Data & privacy"), which the section list scrolls to. */
export function SettingsGroup({ id, title, about, tone, children }: { id: string; title: string; about?: string; tone?: 'danger'; children: ReactNode }) {
  return (
    <section className="acct-group" id={id} data-tone={tone} aria-labelledby={`${id}-title`}>
      <div className="acct-group-head">
        <h2 className="acct-group-title" id={`${id}-title`} tabIndex={-1} data-settings-title>{title}</h2>
        {about && <p className="acct-group-about">{about}</p>}
      </div>
      <Level.Provider value={3}>{children}</Level.Provider>
    </section>
  );
}

/** One setting: its title, one line about it, its actions at the right, and its content under them. */
export function SettingsCard({ id, title, about, badge, actions, tone, busy, className = '', children }: {
  id: string;
  title: ReactNode;
  about?: ReactNode;
  /** a short fact beside the title: a count, a plan, "This device" */
  badge?: ReactNode;
  actions?: ReactNode;
  tone?: 'danger';
  busy?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const Heading = useContext(Level) === 3 ? 'h3' : 'h2';
  return (
    <section className={`acct-card ${className}`.trim()} data-tone={tone} aria-labelledby={`${id}-title`} aria-busy={busy || undefined}>
      <header className="acct-card-head">
        <div className="acct-card-text">
          <div className="acct-card-titles"><Heading className="acct-card-title" id={`${id}-title`}>{title}</Heading>{badge}</div>
          {about && <p className="acct-card-about">{about}</p>}
        </div>
        {actions && <div className="acct-card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** A row inside a card: what it is and one line about it at the left, its one action at the right. */
export function SettingsRow({ title, about, children }: { title: ReactNode; about?: ReactNode; children?: ReactNode }) {
  return (
    <div className="acct-row">
      <div className="acct-row-text"><p className="acct-row-title">{title}</p>{about && <p className="acct-row-about">{about}</p>}</div>
      {children && <div className="acct-row-actions">{children}</div>}
    </div>
  );
}

/** A short fact in a pill. Tone is never the only signal: the words say it too. */
export function Badge({ tone, children }: { tone?: 'accent' | 'ok' | 'warn'; children: ReactNode }) {
  return <span className="badge" data-tone={tone}>{children}</span>;
}

/** A notice inside a card: a mark, the words, and at most one action. */
export function Notice({ tone = 'info', icon, children, action, role = 'status' }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; icon?: IconName; children: ReactNode; action?: ReactNode; role?: 'status' | 'alert' | 'note' }) {
  return (
    <div className="banner acct-notice" data-tone={tone} role={role}>
      <Icon name={icon ?? (tone === 'ok' ? 'check' : tone === 'info' ? 'help' : 'warning')} size="toolbar" />
      <div className="acct-notice-text">{children}</div>
      {action}
    </div>
  );
}
