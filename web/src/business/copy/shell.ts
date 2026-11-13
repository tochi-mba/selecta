// Copy for the business shell, the workspace switcher and band (S7), the business library and
// settings sections, and the pilot admin page (S8) (ADR-0453 D2, D9, D13, D15). Manager and staff
// copy only: plain words, no exclamation marks, no blame, says SelectaDJ and REX Technologies.

import type { Role } from '../types';

export type NavId = 'overview' | 'venues' | 'schedules' | 'library' | 'requests' | 'people' | 'billing' | 'settings';

export const NAV_LABELS: Record<NavId, string> = {
  overview: 'Overview',
  venues: 'Venues',
  schedules: 'Schedules',
  library: 'Library',
  requests: 'Requests',
  people: 'People',
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

export const UPLOAD_COPY = {
  destination: (name: string) => `These songs go to ${name}`,
  uploading: (count: number, name: string) => `Uploading ${count} ${count === 1 ? 'song' : 'songs'} to ${name}`,
} as const;

export const LIBRARY_COPY = {
  title: 'Library',
  intro: (org: string) => `Music in ${org}'s shared library. Venues choose from it with their own crates.`,
  readOnly: 'You can look through the library. Only owners, admins and managers can change it.',
  addMusic: 'Add music',
  readOnlyAfterGrace: 'Update payment to make changes',
  offline: "You're offline",
} as const;

export const SETTINGS_COPY = {
  title: 'Settings',
  licencesHeading: 'Music licences',
  licencesIntro: 'Each venue needs its own licence to play music in public.',
  noLicence: 'No licence yet',
  licenceOk: (date: string) => `Valid until ${date}`,
  licenceExpiring: (date: string) => `Ends on ${date}`,
  licenceExpired: (date: string) => `Date passed on ${date}`,
  openLicence: (venue: string) => `Open ${venue} licence`,
  noVenues: 'No venues yet. Add a venue to record its licence.',
  rulesHeading: 'Music rules',
  rulesIntro: 'Each venue sets which songs can play, when, and how loud. Open a venue to change its rules.',
  openRules: (venue: string) => `Music rules for ${venue}`,
  ssoHeading: 'Single sign-on',
  ssoLocked: (plan: string) => `Single sign-on is part of ${plan}`,
  ssoTalk: 'Talk to REX Technologies about it',
  ssoOn: 'Single sign-on is set up by REX Technologies for your organisation.',
  auditHeading: 'Activity',
  auditEmpty: 'Nothing has happened yet.',
  auditIntro: 'Recent changes and events across your venues.',
} as const;

export type PilotStatus = 'active' | 'ending' | 'ended' | 'converted';

export const PILOT_COPY = {
  title: 'Pilots',
  intro: 'Friendly pilot venues for SelectaDJ for Business. Every change asks for a reason and is recorded.',
  caption: 'Pilot organisations',
  empty: 'No pilots yet. Create one',
  loading: 'Loading pilots',
  loadFailed: "Couldn't load the pilots.",
  offline: "You're offline. The list shows what was last loaded",
  create: 'Create pilot',
  createTitle: 'Create a pilot',
  createNote: 'The owner gets an invitation to set up their first venue.',
  orgName: 'Organisation name',
  ownerEmail: 'Owner email',
  venues: 'Venues allowed',
  zones: 'Zones allowed',
  endDate: 'End date',
  endDateHelp: 'At most 180 days from today. The default is 60 days.',
  note: 'Note (optional)',
  reason: 'Reason',
  reasonHelp: 'Recorded in the audit log.',
  reasonNeeded: 'Give a reason for this change.',
  nameNeeded: 'Enter the organisation name.',
  emailNeeded: 'Enter the owner email.',
  allowanceNeeded: 'Allow at least 1 venue and 1 zone.',
  dateNeeded: 'Choose an end date after today, at most 180 days away.',
  save: 'Save',
  cancel: 'Cancel',
  created: (name: string) => `Pilot created for ${name}. The owner has been invited.`,
  columns: {
    org: 'Organisation', owner: 'Owner email', venues: 'Venues', zones: 'Zones', start: 'Start', end: 'End',
    status: 'Status', activity: 'Last activity', actions: 'Actions',
  },
  used: (used: number, allowed: number) => `${used} of ${allowed}`,
  never: 'None yet',
  status: { active: 'Active', ending: 'Ending soon', ended: 'Ended', converted: 'Converted' } as Record<PilotStatus, string>,
  extend: 'Extend',
  allowance: 'Change allowance',
  convert: 'Convert to paid',
  end: 'End now',
  rowAction: (action: string, org: string) => `${action}: ${org}`,
  extendTitle: (org: string) => `Extend the pilot for ${org}`,
  allowanceTitle: (org: string) => `Change the allowance for ${org}`,
  convertTitle: (org: string) => `Convert ${org} to paid`,
  convertNote: 'The owner gets a link to subscribe. The pilot keeps running until they do.',
  endTitle: (org: string) => `End the pilot for ${org} now`,
  endNote: "Management turns read-only straight away. Music keeps playing tonight and stops at each venue's next closing time, so no venue goes silent mid-service. The owner is told.",
  endConfirm: 'End pilot',
  done: {
    extend: (org: string) => `Pilot for ${org} extended.`,
    allowance: (org: string) => `Allowance for ${org} changed.`,
    convert: (org: string) => `Subscribe link sent to the owner of ${org}.`,
    end: (org: string) => `Pilot for ${org} ended. Music stops at each venue's next closing time.`,
  },
} as const;
