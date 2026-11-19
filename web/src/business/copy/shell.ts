// Copy for the business shell, the workspace switcher and band (S7), and the business library and
// settings sections (ADR-0453 D2, D9, D13, D15). Manager and staff
// copy only: plain words, no exclamation marks, no blame, says SelectaDJ and REX Technologies.

import type { Role } from '../types';

export type NavId = 'overview' | 'venues' | 'schedules' | 'library' | 'requests' | 'people' | 'usage' | 'billing' | 'settings';

export const NAV_LABELS: Record<NavId, string> = {
  overview: 'Overview',
  venues: 'Venues',
  schedules: 'Schedules',
  library: 'Library',
  requests: 'Requests',
  people: 'People',
  usage: 'Usage',
  billing: 'Billing',
  settings: 'Settings',
};

/** The role in words, as the switcher says it ("The Crown Group, manager"). */
export const ROLE_WORDS: Record<Role, string> = {
  owner: 'owner',
  admin: 'admin',
  venue_manager: 'manager',
  staff: 'staff',
  viewer: 'viewer',
};

export function roleWords(role: string | null | undefined): string {
  return (role && (ROLE_WORDS as Record<string, string>)[role]) || (role ?? '').replaceAll('_', ' ');
}

export const SHELL_COPY = {
  brand: 'SelectaDJ',
  company: 'REX Technologies',
  navLabel: 'Business',
  loadingOrg: 'Opening your business workspace',
  missingOrg: "We couldn't find this organisation. It may have been removed, or you may not be a member of it.",
  loadFailed: "We couldn't load this organisation. Check your connection and try again.",
  backToPersonal: 'Back to my personal music',
  notInRole: "This page isn't part of your role here. Ask an owner or admin if you need it.",
  pageOff: "This part of SelectaDJ for Business isn't switched on for your organisation yet.",
  staffNoVenue: "This tablet isn't set up for a zone yet. Ask your manager",
  loadingPage: 'Loading',
  businessMark: 'Business workspace',
  personalMark: 'Personal workspace',
  readOnly: 'Read only',
  roleLine: (role: string) => `You are ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role} here`,
} as const;

export const SWITCHER_COPY = {
  menuLabel: (name: string) => `Workspace: ${name}. Switch workspace`,
  heading: 'Switch workspace',
  personal: 'Personal',
  orgRow: (name: string, role: string) => (role ? `${name}, ${role}` : name),
  current: 'Current',
  loadingRow: 'Loading organisation',
  offline: "You're offline. Switch when you're back",
  silent: (count: number) => (count === 1 ? '1 silent zone' : `${count} silent zones`),
  needsYou: 'Needs you',
  readOnly: 'Read only',
  pilot: 'Pilot',
  playingAskTitle: 'Your music is playing here',
  playingAsk: 'Your music is playing here. Keep it playing while you switch?',
  keepPlaying: 'Keep playing',
  stop: 'Stop',
  cancel: 'Cancel',
  zoneLease: (zone?: string | null) => (zone
    ? `This player is the speaker for ${zone}. Hand the zone back before switching`
    : 'This player is the speaker for a zone. Hand the zone back before switching'),
  switched: (name: string) => `Switched to ${name}`,
  failedList: "Couldn't load your workspaces.",
} as const;

export const LIBRARY_COPY = {
  title: (org: string) => `${org} music library`,
  intro: 'Music you manage here belongs to the organisation, not your personal library.',
  loading: 'Loading music library',
  loadFailed: "Couldn't load music.",
  retry: 'Retry',
  empty: 'No music here yet. Add music to your organisation to make a mix.',
  explicitHeading: 'Explicit markings',
  readOnly: 'This organisation is read-only',
  offline: "You're offline",
} as const;

export const SETTINGS_COPY = {
  title: 'Organisation settings',
  detailsHeading: 'Business details',
  saveDetails: 'Save business details',
  detailsSaved: 'Business details saved',
  detailsFailed: "Couldn't save business details. Try again.",
  readOnly: 'This organisation is read-only',
  offline: "You're offline",
  notAdmin: 'Only an owner or admin can edit settings',
  licencesHeading: 'Music licences',
  licencesIntro: 'Each venue needs its own licence to play music in public.',
  noLicence: 'No licence yet',
  licenceOk: (date: string) => `Valid until ${date}`,
  licenceExpiring: (date: string) => `Ends on ${date}`,
  licenceExpired: (date: string) => `Date passed on ${date}`,
  openLicence: (venue: string) => `Open ${venue} licence`,
  noVenues: 'No venues yet. Add a venue to record its licence.',
  rulesHeading: 'Music rules',
  rulesIntro: 'Each venue sets its own music rules. Open a venue to change them.',
  openRules: (venue: string) => `Music rules for ${venue}`,
  managementHeading: 'Management',
  orgLine: (name: string) => `Organisation: ${name}`,
  countryLine: (country: string) => `Country: ${country}`,
  roleLine: (role: string) => `Role: ${role}`,
  peopleLink: 'People and permissions',
  billingLink: 'Billing and invoices',
} as const;
